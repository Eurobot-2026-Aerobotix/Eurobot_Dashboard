// Smart IP Configuration Manager
class IPConfig {
    constructor() {
        this.STORAGE_KEY = 'eurobot_server_ip';
        this.DEFAULT_IP = '10.42.0.1';
    }

    // Get the configured server IP
    getServerIP() {
        // If we're on localhost, use configured IP
        if (this.isLocalhost()) {
            const savedIP = localStorage.getItem(this.STORAGE_KEY);
            return savedIP || this.DEFAULT_IP;
        }
        
        // If accessed via network, use the hostname from URL
        return window.location.hostname;
    }

    // Check if we're running on localhost
    isLocalhost() {
        const hostname = window.location.hostname;
        return hostname === 'localhost' || 
               hostname === '127.0.0.1' || 
               hostname === '0.0.0.0' ||
               hostname === '';
    }

    // Save custom IP to localStorage
    saveIP(ip) {
        if (!this.validateIP(ip)) {
            throw new Error('Invalid IP address format');
        }
        localStorage.setItem(this.STORAGE_KEY, ip);
    }

    // Get saved IP from localStorage
    getSavedIP() {
        return localStorage.getItem(this.STORAGE_KEY) || this.DEFAULT_IP;
    }

    // Validate IP address format
    validateIP(ip) {
        // Allow both IP addresses and hostnames
        if (!ip || ip.trim() === '') return false;
        
        // IP address pattern (IPv4)
        const ipPattern = /^(\d{1,3}\.){3}\d{1,3}$/;
        
        // Hostname pattern (basic)
        const hostnamePattern = /^[a-zA-Z0-9][a-zA-Z0-9-_.]+[a-zA-Z0-9]$/;
        
        const trimmedIP = ip.trim();
        
        // Check if it's an IP address
        if (ipPattern.test(trimmedIP)) {
            const parts = trimmedIP.split('.');
            return parts.every(part => {
                const num = parseInt(part);
                return num >= 0 && num <= 255;
            });
        }
        
        // Check if it's a hostname
        return hostnamePattern.test(trimmedIP) || trimmedIP === 'localhost';
    }

    // Get full URLs for services
    getAPIURL() {
        return `http://${this.getServerIP()}:8000`;
    }

    getWebSocketURL() {
        return `ws://${this.getServerIP()}:9090`;
    }

    // Get connection info for display
    getConnectionInfo() {
        const ip = this.getServerIP();
        const isLocal = this.isLocalhost();
        const savedIP = this.getSavedIP();
        
        return {
            currentIP: ip,
            isLocalhost: isLocal,
            savedIP: savedIP,
            apiURL: this.getAPIURL(),
            wsURL: this.getWebSocketURL()
        };
    }
}

// Global instance
window.ipConfig = new IPConfig();
