const { logInfo, logError, logWarn } = require('../../services/logService');

/**
 * Service NFC pour MIFARE Classic 1K Gen2
 * ACR122U + @pokusew/pcsclite
 */
class NFCService {
  constructor() {
    this.pcsclite = null;
    this.reader = null;
    this.connection = null;
    this.cardPresent = false;
    this.currentUID = null;
    
    // Clé B fixe PROPASS
    this.PASS_OMEGA = [0xEF, 0x61, 0xA3, 0xD4, 0x8E, 0x2A];

    // DBL strategy: try multiple known keys (Key B) until one authenticates.
    // Stored as hex strings for easier logging/comparison.
    this.AUTH_KEYS = [
      'FFFFFFFFFFFF',
      'A0A1A2A3A4A5',
      '314B49474956',
      'EF61A3D48E2A',
      '001122334455',
      '000102030405',
      'B0B1B2B3B4B5',
      'AAAAAAAAAAAA',
      'BBBBBBBBBBBB',
      'AABBCCDDEEFF'
    ];

    this._activeKeyHex = 'EF61A3D48E2A';
    
    this.callbacks = {
      cardPresent: [],
      cardRemoved: [],
      error: []
    };
  }

  async init() {
    try {
      const pcsclite = require('pcsclite');
      this.pcsclite = pcsclite();
      
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          const e = new Error('NO_READER');
          e.code = 'NO_READER';
          reject(e);
        }, 10000);

        this.pcsclite.on('reader', (reader) => {
          if (reader.name.includes('ACR122U') || reader.name.includes('ACS')) {
            clearTimeout(timeout);
            this.reader = reader;
            this.setupReader();
            logInfo(`[NFC] Lecteur trouvé: ${reader.name}`);
            resolve(this);
          }
        });

        this.pcsclite.on('error', (err) => {
          logError('[NFC] PCSC Error', err);
          reject(err);
        });
      });
      
    } catch (error) {
      const e = new Error('NO_READER');
      e.code = 'NO_READER';
      throw e;
    }
  }

  async waitForCardPresent(timeoutMs = 25000) {
    if (this.cardPresent && this.connection) return { uid: this.currentUID };
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.cardPresent && this.connection) return { uid: this.currentUID };
      await new Promise((r) => setTimeout(r, 200));
    }
    const e = new Error('CARD_TIMEOUT');
    e.code = 'CARD_TIMEOUT';
    throw e;
  }

  setupReader() {
    this.reader.on('status', (status) => {
      const changes = this.reader.state ^ status.state;
      if (changes & this.reader.SCARD_STATE_PRESENT) {
        if (status.state & this.reader.SCARD_STATE_PRESENT) {
          this.handleCardPresent();
        } else {
          this.handleCardRemoved();
        }
      }
    });

    this.reader.on('error', (err) => {
      logError('[NFC] Erreur lecteur', err);
      this.callbacks.error.forEach(cb => cb(err));
    });
  }

  async handleCardPresent() {
    try {
      this.connection = await this.reader.connect({ 
        share_mode: this.reader.SCARD_SHARE_SHARED 
      });
      
      const uid = await this.readUID();
      this.currentUID = uid;
      this.cardPresent = true;
      
      logInfo(`[NFC] Carte Gen2 détectée - UID: ${uid}`);
      this.callbacks.cardPresent.forEach(cb => cb(uid));
      
    } catch (error) {
      logError('[NFC] Erreur connexion carte', error);
    }
  }

  handleCardRemoved() {
    this.cardPresent = false;
    this.currentUID = null;
    try { if (this.connection && typeof this.connection.disconnect === 'function') this.connection.disconnect(); } catch(e) {}
    this.connection = null;
    logInfo('[NFC] Carte retirée');
    this.callbacks.cardRemoved.forEach(cb => cb());
  }

  async transmitWithLog(apdu, expectedLength = 40) {
    try {
      logInfo(`[APDU] --> ${apdu.toString('hex')}`);
      if (!this.connection || typeof this.connection.transmit !== 'function') throw new Error('No connection.transmit available');

      // If transmit is callback-style (fn(apdu, len, cb)), wrap it in a Promise
      const transmitFn = this.connection.transmit;
      let response;
      if (transmitFn.length >= 3) {
        response = await new Promise((resolve, reject) => {
          try {
            transmitFn.call(this.connection, apdu, expectedLength, (err, data) => {
              if (err) return reject(err);
              resolve(data);
            });
          } catch (err) { reject(err); }
        });
      } else {
        // assume promise-based
        response = await transmitFn.call(this.connection, apdu, expectedLength);
      }

      if (response && Buffer.isBuffer(response)) logInfo(`[APDU] <-- ${response.toString('hex')}`);
      return response;
    } catch (e) {
      logError('[APDU] transmit error', e && e.message);
      throw e;
    }
  }

  _keyHexToBytes(keyHex) {
    const h = String(keyHex || '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();
    if (h.length !== 12) return null;
    const out = [];
    for (let i = 0; i < 12; i += 2) out.push(parseInt(h.slice(i, i + 2), 16));
    return out;
  }

  async _loadKeyBToSlot(keyHex, slot = 0x01) {
    const bytes = this._keyHexToBytes(keyHex);
    if (!bytes) throw new Error(`Invalid key hex: ${keyHex}`);
    // FF 82 00 <slot> 06 <key>
    await this.transmitWithLog(Buffer.from([0xFF, 0x82, 0x00, slot & 0xff, 0x06, ...bytes]), 40);
  }

  async _authBlockWithLoadedKey(blockNumber, slot = 0x01) {
    // FF 86 00 00 05 01 00 <block> 61 <slot>
    const res = await this.transmitWithLog(Buffer.from([0xFF, 0x86, 0x00, 0x00, 0x05, 0x01, 0x00, blockNumber & 0xff, 0x61, slot & 0xff]), 40);
    if (!res || res.length < 2) return false;
    return res[res.length - 2] === 0x90 && res[res.length - 1] === 0x00;
  }

  async _preAuthenticateSector(baseBlock) {
    // Try active key first, then the known keys list.
    const candidates = [this._activeKeyHex, ...this.AUTH_KEYS].filter(Boolean);
    for (const keyHex of candidates) {
      try {
        await this._loadKeyBToSlot(keyHex, 0x01);
        const ok = await this._authBlockWithLoadedKey(baseBlock, 0x01);
        if (ok) {
          this._activeKeyHex = keyHex;
          return true;
        }
      } catch (_) {
        // ignore and try next key
      }
    }
    return false;
  }

  async readUID() {
    if (!this.connection) return null;
    try {
      const apdu = Buffer.from([0xFF, 0xCA, 0x00, 0x00, 0x00]);
      const response = await this.transmitWithLog(apdu, 40);
      return response.slice(0, -2).toString('hex').toUpperCase();
    } catch (error) {
      logError('[NFC] Erreur lecture UID', error);
      return 'UNKNOWN';
    }
  }

  /**
   * Lire dump complet 1K Gen2 (1024 bytes)
   */
  async readDump() {
    if (!this.connection) throw new Error('Pas de connexion carte');
    const fullMatrix = Buffer.alloc(1024);
    let blocksRead = 0;

    for (let sector = 0; sector < 16; sector++) {
      const baseBlock = sector * 4;
      try {
        const isAuthed = await this._preAuthenticateSector(baseBlock);
        if (!isAuthed) {
          fullMatrix.fill(0, sector * 64, (sector + 1) * 64);
          continue;
        }

        for (let b = 0; b < 4; b++) {
          const block = baseBlock + b;
          const readRes = await this.transmitWithLog(Buffer.from([0xFF, 0xB0, 0x00, block, 0x10]), 40);
          if (readRes && readRes.length >= 2 && readRes[readRes.length - 2] === 0x90 && readRes[readRes.length - 1] === 0x00) {
            // strip SW1 SW2 if present and copy exactly 16 bytes
            const data = readRes.length > 2 ? readRes.slice(0, readRes.length - 2) : Buffer.alloc(0);
            if (data.length >= 16) data.slice(0,16).copy(fullMatrix, block * 16);
            else {
              const pad = Buffer.alloc(16, 0x00);
              data.copy(pad, 0, 0, data.length);
              pad.copy(fullMatrix, block * 16);
            }
            blocksRead++;
          }
        }
      } catch (e) {
        logWarn(`[NFC] Secteur ${sector} erreur: ${e.message}`);
      }
    }

    return { success: blocksRead >= 60, dump: fullMatrix, blocksRead, uid: fullMatrix.slice(0,4).toString('hex').toUpperCase() };
  }

  /**
   * Écrire dump Gen2 (écrit blocs 0..3 inclus)
   * hexData: hex string of 1024 bytes
   */
  async writeDump(hexData) {
    if (!this.connection) throw new Error('Pas de connexion carte');
    const dumpBuffer = Buffer.from(hexData, 'hex');
    if (dumpBuffer.length !== 1024) throw new Error(`Taille invalide: ${dumpBuffer.length} bytes (attendu: 1024)`);

    let blocksWritten = 0;
    let uidCloned = null;

    for (let sector = 0; sector < 16; sector++) {
      const baseBlock = sector * 4;
      try {
        const isAuthed = await this._preAuthenticateSector(baseBlock);
        if (!isAuthed) continue;

        // write blocks 0,1,2 (data)
        for (let i = 0; i < 3; i++) {
          const blockNum = baseBlock + i;
          const blockData = dumpBuffer.slice(blockNum * 16, (blockNum + 1) * 16);
          const writeRes = await this.transmitWithLog(Buffer.concat([Buffer.from([0xFF,0xD6,0x00,blockNum,0x10]), blockData]), 40);
          if (writeRes && writeRes.length >= 2 && writeRes[writeRes.length - 2] === 0x90 && writeRes[writeRes.length - 1] === 0x00) {
            blocksWritten++;
            if (sector === 0 && i === 0) uidCloned = blockData.slice(0,4).toString('hex').toUpperCase();
          }
        }

        // write trailer (block 3)
        const trailerData = dumpBuffer.slice((baseBlock + 3) * 16, (baseBlock + 4) * 16);
        const trRes = await this.transmitWithLog(Buffer.concat([Buffer.from([0xFF,0xD6,0x00,baseBlock+3,0x10]), trailerData]), 40);
        // consider trailer write as success even if SW ambiguous
      } catch (e) {
        logWarn(`[NFC] Secteur ${sector} écriture échouée: ${e.message}`);
      }
    }

    return { success: blocksWritten >= 45, blocksWritten, uidCloned, message: `Gen2: ${blocksWritten} blocs écrits` };
  }

  // Event handlers
  onCardPresent(callback) { this.callbacks.cardPresent.push(callback); }
  onCardRemoved(callback) { this.callbacks.cardRemoved.push(callback); }
  onError(callback) { this.callbacks.error.push(callback); }

  getReaderName() { return this.reader ? this.reader.name : 'ACR122U'; }
  isConnected() { return this.cardPresent && this.connection !== null; }
  getConnection() { return this.connection; }

  stop() {
    try { if (this.connection && typeof this.connection.disconnect === 'function') this.connection.disconnect(); } catch(e) {}
    this.connection = null;
    try { if (this.pcsclite && typeof this.pcsclite.close === 'function') this.pcsclite.close(); } catch(e) {}
    this.pcsclite = null;
    this.reader = null;
    this.cardPresent = false;
  }
}

module.exports = { NFCService };
