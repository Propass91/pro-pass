package com.propass.mobile;

import android.app.PendingIntent;
import android.content.Intent;
import android.content.IntentFilter;
import android.nfc.NfcAdapter;
import android.nfc.NdefMessage;
import android.nfc.NdefRecord;
import android.nfc.tech.Ndef;
import android.nfc.tech.NdefFormatable;
import android.nfc.tech.MifareClassic;
import android.nfc.Tag;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.webkit.JavascriptInterface;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
	private static final String TAG_LOG = "ProPassNfc";
	private static final byte[] PASS_OMEGA = new byte[] {
			(byte) 0xEF, (byte) 0x61, (byte) 0xA3, (byte) 0xD4, (byte) 0x8E, (byte) 0x2A
	};

	private static final byte[] KEY_SECTOR_0_A = new byte[] {
			(byte) 0xA0, (byte) 0xA1, (byte) 0xA2, (byte) 0xA3, (byte) 0xA4, (byte) 0xA5
	};

	private static final byte[] KEY_SECTORS_1_15_A = new byte[] {
			(byte) 0x31, (byte) 0x4B, (byte) 0x49, (byte) 0x47, (byte) 0x49, (byte) 0x56
	};

	private static final byte[][] KEY_CANDIDATES_SECTOR_0 = new byte[][] {
			KEY_SECTOR_0_A,
			PASS_OMEGA,
			MifareClassic.KEY_DEFAULT,
			MifareClassic.KEY_NFC_FORUM,
			MifareClassic.KEY_MIFARE_APPLICATION_DIRECTORY
	};

	private static final String[] KEY_LABELS_SECTOR_0 = new String[] {
			"KEY_S0_A",
			"PASS_OMEGA",
			"KEY_DEFAULT",
			"KEY_NFC_FORUM",
			"KEY_MAD"
	};

	private static final byte[][] KEY_CANDIDATES_SECTORS_1_15 = new byte[][] {
			PASS_OMEGA,
			KEY_SECTORS_1_15_A,
			MifareClassic.KEY_DEFAULT,
			MifareClassic.KEY_NFC_FORUM,
			MifareClassic.KEY_MIFARE_APPLICATION_DIRECTORY
	};

	private static final String[] KEY_LABELS_SECTORS_1_15 = new String[] {
			"PASS_OMEGA",
			"KEY_S1_15_A",
			"KEY_DEFAULT",
			"KEY_NFC_FORUM",
			"KEY_MAD"
	};

	private NfcAdapter nfcAdapter;
	private PendingIntent pendingIntent;
	private IntentFilter[] intentFilters;
	private String[][] techLists;
	private volatile boolean detectArmed = false;
	private volatile boolean writeArmed = false;
	private volatile String pendingWritePayload = null;
	private volatile String pendingWriteDumpHex = null;
	private volatile Tag lastDetectedTag = null;
	private volatile long lastDetectedAtMs = 0L;

	@Override
	public void onCreate(Bundle savedInstanceState) {
		super.onCreate(savedInstanceState);

		nfcAdapter = NfcAdapter.getDefaultAdapter(this);
		Intent intent = new Intent(this, getClass()).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);

		int flags = PendingIntent.FLAG_UPDATE_CURRENT;
		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
			flags = flags | PendingIntent.FLAG_MUTABLE;
		}
		pendingIntent = PendingIntent.getActivity(this, 0, intent, flags);

		intentFilters = new IntentFilter[] {
				new IntentFilter(NfcAdapter.ACTION_TAG_DISCOVERED),
				new IntentFilter(NfcAdapter.ACTION_TECH_DISCOVERED),
				new IntentFilter(NfcAdapter.ACTION_NDEF_DISCOVERED)
		};

		techLists = new String[][]{};

		if (bridge != null && bridge.getWebView() != null) {
			bridge.getWebView().addJavascriptInterface(new NativeBridge(), "ProPassNative");
		}
	}

	@Override
	public void onResume() {
		super.onResume();
		if (nfcAdapter != null) {
			try {
				nfcAdapter.enableForegroundDispatch(this, pendingIntent, intentFilters, techLists);
			} catch (Exception ignored) {}
		}
	}

	@Override
	public void onPause() {
		if (nfcAdapter != null) {
			try {
				nfcAdapter.disableForegroundDispatch(this);
			} catch (Exception ignored) {}
		}
		super.onPause();
	}

	@Override
	protected void onNewIntent(Intent intent) {
		super.onNewIntent(intent);

		String action = intent != null ? intent.getAction() : null;
		if (action == null) return;

		if (
				NfcAdapter.ACTION_TAG_DISCOVERED.equals(action)
						|| NfcAdapter.ACTION_TECH_DISCOVERED.equals(action)
						|| NfcAdapter.ACTION_NDEF_DISCOVERED.equals(action)
		) {
			Tag tag = intent.getParcelableExtra(NfcAdapter.EXTRA_TAG);
			if (tag == null) return;

			lastDetectedTag = tag;
			lastDetectedAtMs = System.currentTimeMillis();
			String[] techList = tag.getTechList();
			Log.d(TAG_LOG, "onNewIntent tag techs=" + Arrays.toString(techList));

			emitNfcTech(techList);

			if (writeArmed) {
				final String payload = pendingWritePayload;
				final String dumpHex = pendingWriteDumpHex;
				writeArmed = false;
				pendingWritePayload = null;
				pendingWriteDumpHex = null;
				if (dumpHex != null && !dumpHex.trim().isEmpty()) {
					handleTagWriteFromDump(tag, dumpHex);
					return;
				}
				handleTagWrite(tag, payload);
				return;
			}

			if (!detectArmed) return;

			String uid = bytesToHex(tag.getId());
			detectArmed = false;
			emitNfcDetected(uid);
		}
	}

	private void handleTagWriteFromDump(Tag tag, String dumpHex) {
		Log.d(TAG_LOG, "handleTagWriteFromDump start dumpHexLen=" + (dumpHex == null ? 0 : dumpHex.length()));
		MifareClassic mfc = MifareClassic.get(tag);
		if (mfc == null) {
			Log.d(TAG_LOG, "handleTagWriteFromDump MifareClassic absent");
			emitNfcWrite("UNSUPPORTED", "mifare_absent");
			return;
		}
		tryMifareClassicWriteDump(mfc, dumpHex);
	}

	private void handleTagWrite(Tag tag, String payload) {
		Log.d(TAG_LOG, "handleTagWrite start payloadLen=" + (payload == null ? 0 : payload.length()));
		if (payload == null || payload.trim().isEmpty()) {
			emitNfcWrite("ERROR", "payload_vide");
			return;
		}

		// Try MifareClassic raw write first when available.
		// This avoids false "unsupported" on devices that support MifareClassic but not NDEF writes on the same tag.
		MifareClassic mfc = MifareClassic.get(tag);
		if (mfc != null) {
			Log.d(TAG_LOG, "handleTagWrite trying MifareClassic direct write");
			if (tryMifareClassicWrite(mfc, payload)) {
				return;
			}
		}

		NdefRecord record = NdefRecord.createTextRecord("fr", payload);
		NdefMessage message = new NdefMessage(new NdefRecord[] { record });

		try {
			Ndef ndef = Ndef.get(tag);
			if (ndef != null) {
				Log.d(TAG_LOG, "handleTagWrite fallback NDEF path");
				ndef.connect();
				if (!ndef.isWritable()) {
					emitNfcWrite("NOT_WRITABLE", "tag_non_inscriptible");
					try { ndef.close(); } catch (Exception ignored) {}
					return;
				}
				int size = message.toByteArray().length;
				if (ndef.getMaxSize() < size) {
					emitNfcWrite("TOO_SMALL", "tag_trop_petit");
					try { ndef.close(); } catch (Exception ignored) {}
					return;
				}
				ndef.writeNdefMessage(message);
				try { ndef.close(); } catch (Exception ignored) {}
				emitNfcWrite("SUCCESS", "ok");
				return;
			}

			NdefFormatable formatable = NdefFormatable.get(tag);
			if (formatable != null) {
				Log.d(TAG_LOG, "handleTagWrite fallback NdefFormatable path");
				formatable.connect();
				formatable.format(message);
				try { formatable.close(); } catch (Exception ignored) {}
				emitNfcWrite("SUCCESS", "ok");
				return;
			}

			emitNfcWrite("UNSUPPORTED", "tag_non_ndef");
		} catch (Exception e) {
			Log.e(TAG_LOG, "handleTagWrite error", e);
			emitNfcWrite("ERROR", e != null ? e.getClass().getSimpleName() : "write_error");
		}
	}

	private boolean tryMifareClassicWrite(MifareClassic mfc, String payload) {
		try {
			Log.d(TAG_LOG, "tryMifareClassicWrite connect");
			mfc.connect();
			// Give the tag time to settle after RF field/connect.
			Thread.sleep(80);

			int sector = 1;
			if (mfc.getSectorCount() <= sector) {
				Log.d(TAG_LOG, "tryMifareClassicWrite missing sector=" + sector + " sectors=" + mfc.getSectorCount());
				emitNfcWrite("UNSUPPORTED", "mifare_sector_missing");
				try { mfc.close(); } catch (Exception ignored) {}
				return true;
			}

			String authRef = authenticateSectorAny(mfc, sector);
			boolean authenticated = authRef != null;

			if (!authenticated) {
				Log.d(TAG_LOG, "tryMifareClassicWrite auth failed sector=" + sector);
				emitNfcWrite("AUTH_FAILED", "mifare_auth_failed");
				try { mfc.close(); } catch (Exception ignored) {}
				return true;
			}
			Log.d(TAG_LOG, "tryMifareClassicWrite auth ok sector=" + sector + " key=" + authRef);
			Thread.sleep(20);

			int blockIndex = mfc.sectorToBlock(sector);
			byte[] data = new byte[MifareClassic.BLOCK_SIZE];
			byte[] src = payload.getBytes(StandardCharsets.UTF_8);
			int len = Math.min(src.length, data.length);
			System.arraycopy(src, 0, data, 0, len);

			mfc.writeBlock(blockIndex, data);
			Thread.sleep(15);
			byte[] verify = mfc.readBlock(blockIndex);
			if (!Arrays.equals(verify, data)) {
				Log.d(TAG_LOG, "tryMifareClassicWrite verify failed block=" + blockIndex);
				emitNfcWrite("VERIFY_FAILED", "mifare_verify_failed_b" + blockIndex);
				try { mfc.close(); } catch (Exception ignored) {}
				return true;
			}
			Log.d(TAG_LOG, "tryMifareClassicWrite block write ok block=" + blockIndex);
			try { mfc.close(); } catch (Exception ignored) {}
			emitNfcWrite("SUCCESS", "mifare_block_write_ok");
			return true;
		} catch (InterruptedException e) {
			Thread.currentThread().interrupt();
			Log.e(TAG_LOG, "tryMifareClassicWrite interrupted", e);
			emitNfcWrite("ERROR", "interrupted");
			try { mfc.close(); } catch (Exception ignored) {}
			return true;
		} catch (Exception e) {
			Log.e(TAG_LOG, "tryMifareClassicWrite error", e);
			emitNfcWrite("ERROR", e != null ? ("mifare_" + e.getClass().getSimpleName()) : "mifare_write_error");
			try { mfc.close(); } catch (Exception ignored) {}
			return true;
		}
	}

	private boolean tryMifareClassicWriteDump(MifareClassic mfc, String dumpHex) {
		try {
			Log.d(TAG_LOG, "tryMifareClassicWriteDump start");
			byte[] data768 = extractWritableMifareData(dumpHex);
			if (data768 == null || data768.length != (16 * 3 * 16)) {
				Log.d(TAG_LOG, "tryMifareClassicWriteDump invalid dump len=" + (data768 == null ? 0 : data768.length));
				emitNfcWrite("ERROR", "dump_invalid");
				return true;
			}

			mfc.connect();
			Log.d(TAG_LOG, "tryMifareClassicWriteDump connected sectorCount=" + mfc.getSectorCount());
			// Delays improve Magic/clone badge stability on some phones.
			final int CONNECT_DELAY_MS = 100;
			final int AUTH_DELAY_MS = 20;
			final int BLOCK_DELAY_MS = 15;
			final int SECTOR_DELAY_MS = 30;
			Thread.sleep(CONNECT_DELAY_MS);
			// Sector 0 is never written/authenticated in clone mode (UID/manufacturer area).
			int offset = 48;
			int maxSector = Math.min(16, mfc.getSectorCount());

			for (int sector = 1; sector < maxSector; sector++) {

				String authRef = authenticateSectorAny(mfc, sector);
				boolean auth = authRef != null;

				if (!auth) {
					Log.d(TAG_LOG, "tryMifareClassicWriteDump auth failed sector=" + sector);
					emitNfcWrite("AUTH_FAILED", "mifare_auth_failed_s" + sector);
					try { mfc.close(); } catch (Exception ignored) {}
					return true;
				}
				Log.d(TAG_LOG, "tryMifareClassicWriteDump auth ok sector=" + sector + " key=" + authRef);
				Thread.sleep(AUTH_DELAY_MS);

				for (int blockInSector = 0; blockInSector < 3; blockInSector++) {
					int absBlock = mfc.sectorToBlock(sector) + blockInSector;
					byte[] blockData = new byte[16];
					System.arraycopy(data768, offset, blockData, 0, 16);
					offset += 16;

					mfc.writeBlock(absBlock, blockData);
					Thread.sleep(BLOCK_DELAY_MS);
					byte[] verify = mfc.readBlock(absBlock);
					if (!Arrays.equals(verify, blockData)) {
						Log.d(TAG_LOG, "tryMifareClassicWriteDump verify failed sector=" + sector + " block=" + absBlock);
						emitNfcWrite("VERIFY_FAILED", "mifare_verify_failed_s" + sector + "_b" + absBlock);
						try { mfc.close(); } catch (Exception ignored) {}
						return true;
					}
					Log.d(TAG_LOG, "tryMifareClassicWriteDump write ok sector=" + sector + " block=" + absBlock);
				}
				Thread.sleep(SECTOR_DELAY_MS);
			}

			try { mfc.close(); } catch (Exception ignored) {}
			Log.d(TAG_LOG, "tryMifareClassicWriteDump success");
			emitNfcWrite("SUCCESS", "mifare_dump_write_ok");
			return true;
		} catch (InterruptedException e) {
			Thread.currentThread().interrupt();
			Log.e(TAG_LOG, "tryMifareClassicWriteDump interrupted", e);
			emitNfcWrite("ERROR", "interrupted");
			try { mfc.close(); } catch (Exception ignored) {}
			return true;
		} catch (Exception e) {
			Log.e(TAG_LOG, "tryMifareClassicWriteDump error", e);
			emitNfcWrite("ERROR", e != null ? ("mifare_dump_" + e.getClass().getSimpleName()) : "mifare_dump_write_error");
			try { mfc.close(); } catch (Exception ignored) {}
			return true;
		}
	}

	private byte[] extractWritableMifareData(String dumpHexRaw) {
		if (dumpHexRaw == null) return null;
		String hex = dumpHexRaw.trim().replaceAll("\\s+", "").toLowerCase();
		if (hex.isEmpty() || (hex.length() % 2) != 0 || !hex.matches("^[0-9a-f]+$")) {
			return null;
		}

		byte[] src = hexToBytes(hex);
		if (src == null || src.length < 768) return null;

		if (src.length >= 1024) {
			byte[] out = new byte[768];
			int outPos = 0;
			for (int sector = 0; sector < 16; sector++) {
				int sectorOffset = sector * 64;
				for (int i = 0; i < 48; i++) {
					out[outPos++] = src[sectorOffset + i];
				}
			}
			return out;
		}

		byte[] out = new byte[768];
		System.arraycopy(src, 0, out, 0, 768);
		return out;
	}

	private String authenticateSectorAny(MifareClassic mfc, int sector) {
		byte[][] keyCandidates = sector == 0 ? KEY_CANDIDATES_SECTOR_0 : KEY_CANDIDATES_SECTORS_1_15;
		String[] keyLabels = sector == 0 ? KEY_LABELS_SECTOR_0 : KEY_LABELS_SECTORS_1_15;

		for (int i = 0; i < keyCandidates.length; i++) {
			byte[] key = keyCandidates[i];
			String label = i < keyLabels.length ? keyLabels[i] : ("KEY_" + i);
			if (key == null || key.length != 6) continue;
			try {
				if (mfc.authenticateSectorWithKeyA(sector, key)) return "A:" + label;
			} catch (Exception ignored) {}
			try {
				if (mfc.authenticateSectorWithKeyB(sector, key)) return "B:" + label;
			} catch (Exception ignored) {}
		}
		return null;
	}

	private byte[] hexToBytes(String hex) {
		int len = hex.length();
		if ((len % 2) != 0) return null;
		byte[] out = new byte[len / 2];
		for (int i = 0; i < len; i += 2) {
			int hi = Character.digit(hex.charAt(i), 16);
			int lo = Character.digit(hex.charAt(i + 1), 16);
			if (hi < 0 || lo < 0) return null;
			out[i / 2] = (byte) ((hi << 4) + lo);
		}
		return out;
	}

	private void emitNfcDetected(String uid) {
		if (bridge == null || bridge.getWebView() == null) return;
		final String safeUid = uid == null ? "" : uid.replace("'", "");
		runOnUiThread(() -> bridge.getWebView().evaluateJavascript(
				"window.dispatchEvent(new CustomEvent('propass:nfc-detected',{detail:{uid:'" + safeUid + "'}}));",
				null
		));
	}

	private void emitNfcStatus(String status) {
		if (bridge == null || bridge.getWebView() == null) return;
		final String safeStatus = status == null ? "" : status.replace("'", "");
		runOnUiThread(() -> bridge.getWebView().evaluateJavascript(
				"window.dispatchEvent(new CustomEvent('propass:nfc-status',{detail:{status:'" + safeStatus + "'}}));",
				null
		));
	}

	private void emitNfcTech(String[] techList) {
		if (bridge == null || bridge.getWebView() == null) return;
		String joined = "";
		if (techList != null && techList.length > 0) {
			StringBuilder sb = new StringBuilder();
			for (int i = 0; i < techList.length; i++) {
				String t = techList[i] == null ? "" : techList[i];
				if (i > 0) sb.append(",");
				sb.append(t.replace("'", ""));
			}
			joined = sb.toString();
		}
		final String safeJoined = joined;
		runOnUiThread(() -> bridge.getWebView().evaluateJavascript(
				"window.dispatchEvent(new CustomEvent('propass:nfc-tech',{detail:{tech:'" + safeJoined + "'}}));",
				null
		));
	}

	private void emitNfcWrite(String status, String message) {
		if (bridge == null || bridge.getWebView() == null) return;
		final String safeStatus = status == null ? "" : status.replace("'", "");
		final String safeMessage = message == null ? "" : message.replace("'", "");
		runOnUiThread(() -> bridge.getWebView().evaluateJavascript(
				"window.dispatchEvent(new CustomEvent('propass:nfc-write',{detail:{status:'" + safeStatus + "',message:'" + safeMessage + "'}}));",
				null
		));
	}

	private String bytesToHex(byte[] bytes) {
		if (bytes == null || bytes.length == 0) return "";
		StringBuilder sb = new StringBuilder();
		for (byte value : bytes) {
			sb.append(String.format("%02X", value));
		}
		return sb.toString();
	}

	public class NativeBridge {
		@JavascriptInterface
		public void armDetect() {
			if (nfcAdapter == null) {
				emitNfcStatus("UNSUPPORTED");
				return;
			}
			if (!nfcAdapter.isEnabled()) {
				emitNfcStatus("DISABLED");
				return;
			}
			detectArmed = true;
			emitNfcStatus("ARMED");
		}

		@JavascriptInterface
		public void armWrite(String payload) {
			if (nfcAdapter == null) {
				emitNfcWrite("UNSUPPORTED", "nfc_absent");
				return;
			}
			if (!nfcAdapter.isEnabled()) {
				emitNfcWrite("DISABLED", "nfc_desactive");
				return;
			}

			// Fast-path: if a tag was just detected, write immediately without waiting for another tap.
			long ageMs = System.currentTimeMillis() - lastDetectedAtMs;
			if (lastDetectedTag != null && ageMs >= 0 && ageMs < 12000) {
				handleTagWrite(lastDetectedTag, payload == null ? "" : payload);
				return;
			}

			pendingWritePayload = payload == null ? "" : payload;
			pendingWriteDumpHex = null;
			writeArmed = true;
			emitNfcWrite("ARMED", "ready");
		}

		@JavascriptInterface
		public void armWriteDump(String dumpHex) {
			if (nfcAdapter == null) {
				emitNfcWrite("UNSUPPORTED", "nfc_absent");
				return;
			}
			if (!nfcAdapter.isEnabled()) {
				emitNfcWrite("DISABLED", "nfc_desactive");
				return;
			}

			String safeHex = dumpHex == null ? "" : dumpHex.trim();
			if (safeHex.isEmpty()) {
				emitNfcWrite("ERROR", "dump_missing");
				return;
			}

			long ageMs = System.currentTimeMillis() - lastDetectedAtMs;
			if (lastDetectedTag != null && ageMs >= 0 && ageMs < 12000) {
				handleTagWriteFromDump(lastDetectedTag, safeHex);
				return;
			}

			pendingWritePayload = null;
			pendingWriteDumpHex = safeHex;
			writeArmed = true;
			emitNfcWrite("ARMED", "ready_dump_v15");
		}
	}
}
