// Portfolio Analytics Configuration
// Setup your notification services here

const ANALYTICS_CONFIG = {
    // Telegram Bot Configuration
    telegram: {
        enabled: false, // Set to true to enable Telegram notifications
        botToken: 'YOUR_BOT_TOKEN', // Get from @BotFather on Telegram
        chatId: 'YOUR_CHAT_ID', // Your Telegram chat ID
    },
    
    // Discord Webhook Configuration  
    discord: {
        enabled: false, // Set to true to enable Discord notifications
        webhookUrl: 'YOUR_DISCORD_WEBHOOK_URL', // Create webhook in Discord channel
    },
    
    // Email Configuration (using EmailJS)
    email: {
        enabled: false, // Set to true to enable email notifications
        serviceId: 'YOUR_EMAILJS_SERVICE_ID',
        templateId: 'YOUR_EMAILJS_TEMPLATE_ID',
        publicKey: 'YOUR_EMAILJS_PUBLIC_KEY',
        toEmail: 'areskretindo@gmail.com', // Your email address
    },
    
    // Google Analytics
    googleAnalytics: {
        enabled: false, // Set to true to enable Google Analytics
        trackingId: 'GA_TRACKING_ID', // Your Google Analytics tracking ID
    },
    
    // Local Storage Settings
    localStorage: {
        enabled: true, // Keep visitor data in browser localStorage
        retentionDays: 30, // How many days to keep data
    }
};

// Instructions:
// 1. Telegram Setup:
//    - Message @BotFather on Telegram
//    - Create new bot with /newbot command
//    - Copy the bot token
//    - Get your chat ID by messaging @userinfobot
//
// 2. Discord Setup:
//    - Go to your Discord server
//    - Edit channel → Integrations → Webhooks
//    - Create new webhook and copy URL
//
// 3. EmailJS Setup:
//    - Sign up at emailjs.com
//    - Create email service and template
//    - Copy service ID, template ID, and public key

export default ANALYTICS_CONFIG;
