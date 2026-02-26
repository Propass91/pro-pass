const emailService = require('./utils/emailService');

async function testEmails() {
    console.log('🧪 Test des templates email PROPASS\n');

    try {
        // Test 1 : Email de réinitialisation
        console.log('1️⃣ Génération email mot de passe oublié...');
        const resetEmail = await emailService.generatePasswordResetEmail({
            userName: 'Jean Dupont',
            resetCode: '842-917',
            expirationMinutes: 15
        });
        console.log('✅ Template chargé:', resetEmail.length, 'caractères\n');

        // Test 2 : Email de bienvenue
        console.log('2️⃣ Génération email bienvenue...');
        const welcomeEmail = await emailService.generateWelcomeEmail({
            userName: 'Marie Martin',
            clientEmail: 'marie.martin@exemple.fr'
        });
        console.log('✅ Template chargé:', welcomeEmail.length, 'caractères\n');

        // Test 3 : Simulation d'envoi
        console.log('3️⃣ Simulation envoi email...');
        await emailService.sendEmail({
            to: 'client@exemple.com',
            subject: '🛡️ Bienvenue sur PROPASS',
            html: welcomeEmail
        });

        console.log('\n✅ Tous les tests passés ! Système prêt.\n');

    } catch (error) {
        console.error('❌ Erreur durant les tests:', error.message);
        process.exit(1);
    }
}

testEmails();
