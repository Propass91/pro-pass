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

async function sendInvitationEmail({ to, downloadUrl, username, email, tempPassword }) {
  const transport = makeTransportOrThrow();

  const from = process.env.SMTP_FROM || 'PROPASS <no-reply@propass.local>';
  const subject = 'PROPASS – Téléchargement & activation';

  const safeDownloadUrl = String(downloadUrl || '');
  const safeUsername = String(username || '');
  const safeEmail = String(email || to || '');
  const safePassword = String(tempPassword || '');

  const text = `Bonjour,\n\nVotre accès PROPASS est prêt.\n\n1) Télécharger l'application :\n${safeDownloadUrl}\n\n2) Vos informations de connexion :\n- Email : ${safeEmail}\n- Identifiant : ${safeUsername}\n\n3) Mot de passe généré automatiquement (6 premières lettres de votre email) :\n${safePassword}\n\nTéléchargez l'application puis connectez-vous avec ces informations.\n`;

  const html = `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>PROPASS</title>
  </head>
  <body style="margin:0; padding:0; background:#070f24;">
    <div style="max-width:700px; margin:0 auto; padding:28px 18px; font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;">
      <div style="background:linear-gradient(180deg,#0b1630 0%,#0a132a 100%); border:1px solid #213252; border-radius:16px; padding:26px; color:#eaf1ff; box-shadow:0 10px 30px rgba(0,0,0,.35);">
        <div style="font-weight:900; font-size:20px; letter-spacing:0.6px; color:#38bdf8;">PROPASS</div>
        <div style="height:10px;"></div>

        <div style="font-size:18px; font-weight:800;">Votre accès client est prêt</div>
        <div style="height:6px;"></div>
        <div style="color:#b9c9e6; font-size:14px; line-height:22px;">Suivez ces 3 étapes pour installer et utiliser l'application.</div>

        <div style="height:20px;"></div>

        <div style="display:flex; gap:12px; align-items:flex-start;">
          <div style="min-width:30px; height:30px; border-radius:999px; background:#0ea5e9; color:#001225; display:flex; align-items:center; justify-content:center; font-weight:900;">1</div>
          <div>
            <div style="font-weight:800; font-size:16px;">Télécharger l'application</div>
            <div style="color:#b9c9e6; font-size:14px; line-height:20px;">Téléchargez puis installez PROPASS sur votre ordinateur.</div>
            <div style="height:12px;"></div>
            <a href="${safeDownloadUrl.replace(/"/g, '&quot;')}" style="display:inline-block; padding:14px 22px; border-radius:12px; background:linear-gradient(135deg,#22d3ee,#0ea5e9); color:#062035; text-decoration:none; font-weight:900; font-size:16px;">⬇ Télécharger PROPASS</a>
          </div>
        </div>

        <div style="height:18px;"></div>

        <div style="display:flex; gap:12px; align-items:flex-start;">
          <div style="min-width:30px; height:30px; border-radius:999px; background:#0ea5e9; color:#001225; display:flex; align-items:center; justify-content:center; font-weight:900;">2</div>
          <div>
            <div style="font-weight:800; font-size:16px;">Vos informations de connexion</div>
            <div style="color:#d8e4fa; font-size:14px; line-height:22px; margin-top:6px;">
              Email : <b>${safeEmail.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</b><br />
              Identifiant : <b>${safeUsername.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</b>
            </div>
          </div>
        </div>

        <div style="height:18px;"></div>

        <div style="display:flex; gap:12px; align-items:flex-start;">
          <div style="min-width:30px; height:30px; border-radius:999px; background:#0ea5e9; color:#001225; display:flex; align-items:center; justify-content:center; font-weight:900;">3</div>
          <div>
            <div style="font-weight:800; font-size:16px;">Mot de passe généré automatiquement</div>
            <div style="color:#b9c9e6; font-size:14px; line-height:20px;">Votre mot de passe est généré avec les 6 premières lettres de votre email.</div>
            <div style="height:10px;"></div>
            <div style="display:inline-block; padding:11px 14px; border-radius:10px; border:1px solid #36527d; background:#09162f; color:#67e8f9; font-weight:900; font-size:18px; letter-spacing:1px;">
              ${safePassword.replace(/</g, '&lt;').replace(/>/g, '&gt;')}
            </div>
          </div>
        </div>

        <div style="height:18px;"></div>
        <div style="color:#9eb2d8; font-size:12px; line-height:18px; border-top:1px solid #20314f; padding-top:14px;">
          Si le bouton ne fonctionne pas, copiez/collez ce lien :<br />
          ${safeDownloadUrl.replace(/</g, '&lt;').replace(/>/g, '&gt;')}
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
