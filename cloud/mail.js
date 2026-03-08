const nodemailer = require('nodemailer');

function parseBool(value, defaultValue = false) {
  if (value == null) return Boolean(defaultValue);
  const v = String(value).trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes' || v === 'y' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'n' || v === 'off') return false;
  return Boolean(defaultValue);
}

function humanizeSmtpError(err) {
  const msg = String((err && err.message) || err || '').trim();
  const code = String((err && err.code) || '').trim();
  const response = String((err && err.response) || '').trim();

  const haystack = `${code} ${msg} ${response}`.toLowerCase();
  const looksLikeGmailBadCreds =
    code === 'EAUTH' ||
    haystack.includes('535') ||
    haystack.includes('badcredentials') ||
    haystack.includes('username and password not accepted');

  if (looksLikeGmailBadCreds) {
    return `Connexion SMTP refusée par Gmail (535). Pour Gmail il faut activer la double authentification (2FA) puis générer un "mot de passe d’application" (16 caractères) et le mettre dans SMTP_PASS. Détail: ${msg || code || 'EAUTH'}`;
  }

  if (code === 'ECONNECTION' || haystack.includes('econnrefused') || haystack.includes('timed out')) {
    return `Impossible de se connecter au serveur SMTP. Vérifie SMTP_HOST/SMTP_PORT/SMTP_SECURE et le firewall. Détail: ${msg || code}`;
  }

  return msg || code || 'SMTP error';
}

function makeTransportOrThrow() {
  const host = String(process.env.SMTP_HOST || '').trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = parseBool(process.env.SMTP_SECURE, port === 465);
  const user = String(process.env.SMTP_USER || '').trim();
  const pass = String(process.env.SMTP_PASS || '').trim();

  const missing = [];
  if (!host) missing.push('SMTP_HOST');
  if (!user) missing.push('SMTP_USER');
  if (!pass) missing.push('SMTP_PASS');

  if (missing.length) {
    const looksLikeGmail = host.toLowerCase().includes('gmail') || user.toLowerCase().endsWith('@gmail.com');
    const hint = looksLikeGmail
      ? ' Gmail: utilise un "mot de passe d’application" (16 caractères), pas ton mot de passe Gmail.'
      : '';
    throw new Error(`SMTP non configuré: ${missing.join(', ')} manquant(s).${hint}`);
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    // On port 587 (STARTTLS), nodemailer will upgrade if supported.
    requireTLS: !secure
  });
}

async function sendPasswordResetEmail({ to, resetUrl }) {
  const transport = makeTransportOrThrow();

  const from = process.env.SMTP_FROM || 'PROPASS <no-reply@propass.local>';
  const subject = 'PROPASS – Réinitialisation du mot de passe';
  const token = (() => {
    try {
      const u = new URL(String(resetUrl));
      return u.searchParams.get('token') || '';
    } catch (_) {
      return '';
    }
  })();

  const text = `Bonjour,\n\nVous avez demandé une réinitialisation de mot de passe.\n\nToken (à copier/coller dans l'application) :\n${token || '(indisponible)'}\n\nLien (optionnel) :\n${resetUrl}\n\nSi vous n\'êtes pas à l\'origine de cette demande, ignorez ce message.\n`;

  try {
    await transport.sendMail({ from, to, subject, text });
  } catch (e) {
    throw new Error(humanizeSmtpError(e));
  }
}

async function sendInvitationEmail({ to, downloadUrl, username, tempPassword }) {
  const transport = makeTransportOrThrow();

  const from = process.env.SMTP_FROM || 'PROPASS <no-reply@propass.local>';
  const subject = 'PROPASS – Téléchargement & activation';

  const resetUrl = arguments[0] && arguments[0].resetUrl ? String(arguments[0].resetUrl) : '';

  const text = `Bonjour,\n\nVotre accès PROPASS est prêt.\n\n1) Télécharger l'application :\n${downloadUrl}\n\n2) Identifiant : ${username}\n\n3) Créer votre mot de passe (lien unique) :\n${resetUrl || '(indisponible)'}\n\nNote: Sur certains PC, Windows/Chrome peut afficher un avertissement car l'application n'est pas encore signée numériquement.\n- Chrome: ouvrir les téléchargements (Ctrl+J) puis choisir "Conserver" si demandé.\n- Windows SmartScreen: cliquer "Informations complémentaires" puis "Exécuter quand même".\n- Si Windows bloque le fichier: clic droit sur le .exe > Propriétés > cocher "Débloquer" (si présent) > Appliquer.\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez ce message.\n`;

  const html = `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>PROPASS</title>
  </head>
  <body style="margin:0; padding:0; background:#f6f6f6;">
    <div style="max-width:640px; margin:0 auto; padding:24px; font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;">
      <div style="background:#ffffff; border-radius:12px; padding:24px;">
        <div style="font-weight:800; font-size:18px; letter-spacing:0.5px;">PROPASS</div>
        <div style="height:16px;"></div>

        <div style="font-size:16px; font-weight:700;">Votre accès est prêt</div>
        <div style="height:8px;"></div>
        <div style="color:#333; font-size:14px; line-height:20px;">Suivez ces 3 étapes pour installer et activer l'application.</div>

        <div style="height:18px;"></div>

        <div style="display:flex; gap:12px; align-items:flex-start;">
          <div style="min-width:28px; height:28px; border-radius:999px; background:#111; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:700;">1</div>
          <div>
            <div style="font-weight:700;">Télécharger</div>
            <div style="color:#444; font-size:14px; line-height:20px;">Téléchargez et installez l'application PROPASS.</div>
            <div style="height:10px;"></div>
            <a href="${String(downloadUrl || '').replace(/"/g, '&quot;')}" style="display:inline-block; padding:12px 16px; border-radius:10px; background:#111; color:#fff; text-decoration:none; font-weight:700;">Télécharger PROPASS</a>
          </div>
        </div>

        <div style="height:16px;"></div>

        <div style="display:flex; gap:12px; align-items:flex-start;">
          <div style="min-width:28px; height:28px; border-radius:999px; background:#111; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:700;">2</div>
          <div>
            <div style="font-weight:700;">Identification</div>
            <div style="color:#444; font-size:14px; line-height:20px;">Identifiant : <b>${String(username || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</b></div>
          </div>
        </div>

        <div style="height:16px;"></div>

        <div style="display:flex; gap:12px; align-items:flex-start;">
          <div style="min-width:28px; height:28px; border-radius:999px; background:#111; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:700;">3</div>
          <div>
            <div style="font-weight:700;">Activation</div>
            <div style="color:#444; font-size:14px; line-height:20px;">Créez votre mot de passe via ce lien unique.</div>
            <div style="height:10px;"></div>
            <a href="${String(resetUrl || '').replace(/"/g, '&quot;')}" style="display:inline-block; padding:12px 16px; border-radius:10px; background:#111; color:#fff; text-decoration:none; font-weight:700;">Créer mon mot de passe</a>
          </div>
        </div>

        <div style="height:18px;"></div>
        <div style="color:#777; font-size:12px; line-height:18px;">
          Si le bouton ne fonctionne pas, copiez/collez ce lien dans votre navigateur :<br />${String(resetUrl || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}
        </div>

        <div style="height:14px;"></div>
        <div style="color:#777; font-size:12px; line-height:18px;">
          <b>Téléchargement bloqué ?</b><br />
          Chrome : ouvrez les téléchargements (Ctrl+J) puis cliquez sur <b>Conserver</b> si demandé.<br />
          Windows SmartScreen : cliquez sur <b>Informations complémentaires</b> puis <b>Exécuter quand même</b>.<br />
          Si Windows bloque le fichier : clic droit sur le .exe &gt; <b>Propriétés</b> &gt; cochez <b>Débloquer</b> (si présent) puis <b>Appliquer</b>.
        </div>
      </div>
    </div>
  </body>
</html>`;

  try {
    await transport.sendMail({ from, to, subject, text, html });
  } catch (e) {
    throw new Error(humanizeSmtpError(e));
  }
}

module.exports = {
  sendPasswordResetEmail,
  sendInvitationEmail
};
