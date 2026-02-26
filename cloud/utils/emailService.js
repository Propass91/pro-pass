const fs = require('fs').promises;
const path = require('path');

/**
 * Service de gestion des emails PROPASS
 * Gère le chargement et la personnalisation des templates HTML
 */
class EmailService {
    constructor() {
        this.templatesDir = path.join(__dirname, '../templates/emails');
    }

    /**
     * Charge un template HTML depuis le disque
     * @param {string} templateName - Nom du fichier (sans extension)
     * @returns {Promise<string>} Contenu HTML brut
     */
    async loadTemplate(templateName) {
        const templatePath = path.join(this.templatesDir, `${templateName}.html`);
        try {
            const content = await fs.readFile(templatePath, 'utf-8');
            return content;
        } catch (error) {
            console.error(`❌ Erreur chargement template ${templateName}:`, error.message);
            throw new Error(`Template "${templateName}" introuvable`);
        }
    }

    /**
     * Remplace les variables {{variable}} dans le template
     * @param {string} template - HTML brut avec placeholders
     * @param {Object} variables - Objet clé-valeur des remplacements
     * @returns {string} HTML personnalisé
     */
    replaceVariables(template, variables) {
        let result = template;

        // Ajoute automatiquement l'année courante
        variables.currentYear = variables.currentYear || new Date().getFullYear();

        // Remplace les variables simples {{variable}}
        Object.keys(variables).forEach(key => {
            const regex = new RegExp(`{{${key}}}`, 'g');
            result = result.replace(regex, variables[key] || '');
        });

        // Gère les conditions {{#if variable}}...{{/if}}
        result = result.replace(/{{#if\s+(\w+)}}(.*?){{\/if}}/gs, (match, condition, content) => {
            return variables[condition] ? content : '';
        });

        return result;
    }

    /**
     * Génère un email de réinitialisation de mot de passe
     * @param {Object} data - Données du destinataire
     * @returns {Promise<string>} HTML complet et personnalisé
     */
    async generatePasswordResetEmail(data) {
        const template = await this.loadTemplate('password-reset');
        
        const variables = {
            userName: data.userName || '',
            resetCode: data.resetCode || '000-000',
            expirationMinutes: data.expirationMinutes || 15
        };

        return this.replaceVariables(template, variables);
    }

    /**
     * Génère un email de bienvenue pour nouveau client
     * @param {Object} data - Données du nouveau client
     * @returns {Promise<string>} HTML complet et personnalisé
     */
    async generateWelcomeEmail(data) {
        const template = await this.loadTemplate('welcome');
        
        const variables = {
            userName: data.userName || '',
            clientEmail: data.clientEmail || 'votre-email@exemple.com'
        };

        return this.replaceVariables(template, variables);
    }

    /**
     * Envoie un email (fonction de démonstration - à adapter avec votre provider)
     * @param {Object} options - Configuration de l'email
     */
    async sendEmail(options) {
        const { to, subject, html } = options;

        console.log('\n📧 ===== EMAIL PRÊT À ENVOYER =====');
        console.log(`À: ${to}`);
        console.log(`Sujet: ${subject}`);
        console.log(`Taille HTML: ${html.length} caractères`);
        console.log('====================================\n');

        // ICI : Intégration avec votre service mail (Nodemailer, SendGrid, etc.)
        // Exemple avec Nodemailer :
        /*
        const transporter = nodemailer.createTransport({
            host: 'smtp.votre-serveur.com',
            port: 587,
            secure: false,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
        });

        await transporter.sendMail({
            from: '"PROPASS Security" <noreply@propass.com>',
            to: to,
            subject: subject,
            html: html
        });
        */

        return {
            success: true,
            message: 'Email préparé (envoi réel à configurer)'
        };
    }
}

// Export singleton
module.exports = new EmailService();
