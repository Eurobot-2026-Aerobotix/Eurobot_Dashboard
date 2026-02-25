// Use the smart IP configuration
const API_URL = window.ipConfig.getAPIURL();

// Settings Modal Elements
const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const closeModal = document.querySelector('.close');
const serverIPInput = document.getElementById('serverIP');
const saveIPBtn = document.getElementById('saveIPBtn');
const autoDetectBtn = document.getElementById('autoDetectBtn');
const settingsMessage = document.getElementById('settingsMessage');
const currentModeSpan = document.getElementById('currentMode');
const currentIPSpan = document.getElementById('currentIP');

const prepareBtn = document.getElementById('prepareBtn');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const testPamiBtn = document.getElementById('testPamiBtn');
const statusDiv = document.getElementById('status');
const outputDiv = document.getElementById('output');
const outputSelector = document.getElementById('outputSelector');

let strategyEventSource = null;
let pathfindingEventSource = null;
let pamiEventSource = null;
let currentSource = 'strategy';

// Separate output buffers for each source - persist in localStorage
let strategyOutput = JSON.parse(localStorage.getItem('strategyOutput') || '[]');
let pathfindingOutput = JSON.parse(localStorage.getItem('pathfindingOutput') || '[]');
let pamiOutput = JSON.parse(localStorage.getItem('pamiOutput') || '[]');

// Load saved current source
const savedSource = localStorage.getItem('currentSource');
if (savedSource) {
    currentSource = savedSource;
    outputSelector.value = savedSource;
}

// Display existing output on page load
displayCurrentOutput();

// Auto-reconnect to streams if processes are running
if (strategyOutput.length > 0) {
    startStreaming('strategy');
}
if (pathfindingOutput.length > 0) {
    startStreaming('pathfinding');
}
if (pamiOutput.length > 0) {
    startStreaming('pami');
}

// Handle output source change
outputSelector.addEventListener('change', function() {
    currentSource = outputSelector.value;
    localStorage.setItem('currentSource', currentSource);
    displayCurrentOutput();
});

function displayCurrentOutput() {
    const outputs = currentSource === 'strategy' ? strategyOutput : 
                    currentSource === 'pathfinding' ? pathfindingOutput : pamiOutput;
    outputDiv.innerHTML = '';
    
    outputs.forEach(text => {
        const line = document.createElement('div');
        line.className = 'output-line';
        line.textContent = text;
        outputDiv.appendChild(line);
    });
    
    // Auto-scroll to bottom
    outputDiv.scrollTop = outputDiv.scrollHeight;
}

function startStreaming(source) {
    if (source === 'strategy') {
        if (strategyEventSource) {
            strategyEventSource.close();
        }
        
        strategyEventSource = new EventSource(`${API_URL}/stream/strategy`);
        
        strategyEventSource.onmessage = function(event) {
            strategyOutput.push(event.data);
            localStorage.setItem('strategyOutput', JSON.stringify(strategyOutput));
            
            if (currentSource === 'strategy') {
                const line = document.createElement('div');
                line.className = 'output-line';
                line.textContent = event.data;
                outputDiv.appendChild(line);
                outputDiv.scrollTop = outputDiv.scrollHeight;
            }
        };
        
        strategyEventSource.onerror = function(error) {
            console.error('Strategy EventSource error:', error);
        };
    } else if (source === 'pathfinding') {
        if (pathfindingEventSource) {
            pathfindingEventSource.close();
        }
        
        pathfindingEventSource = new EventSource(`${API_URL}/stream/pathfinding`);
        
        pathfindingEventSource.onmessage = function(event) {
            pathfindingOutput.push(event.data);
            localStorage.setItem('pathfindingOutput', JSON.stringify(pathfindingOutput));
            
            if (currentSource === 'pathfinding') {
                const line = document.createElement('div');
                line.className = 'output-line';
                line.textContent = event.data;
                outputDiv.appendChild(line);
                outputDiv.scrollTop = outputDiv.scrollHeight;
            }
        };
        
        pathfindingEventSource.onerror = function(error) {
            console.error('Pathfinding EventSource error:', error);
        };
    } else if (source === 'pami') {
        if (pamiEventSource) {
            pamiEventSource.close();
        }
        
        pamiEventSource = new EventSource(`${API_URL}/stream/pami`);
        
        pamiEventSource.onmessage = function(event) {
            pamiOutput.push(event.data);
            localStorage.setItem('pamiOutput', JSON.stringify(pamiOutput));
            
            if (currentSource === 'pami') {
                const line = document.createElement('div');
                line.className = 'output-line';
                line.textContent = event.data;
                outputDiv.appendChild(line);
                outputDiv.scrollTop = outputDiv.scrollHeight;
            }
        };
        
        pamiEventSource.onerror = function(error) {
            console.error('PAMI EventSource error:', error);
        };
    }
}

function showStatus(message, type = 'info') {
    const statusMsg = document.createElement('div');
    statusMsg.className = `status-message status-${type}`;
    statusMsg.textContent = message;
    statusDiv.appendChild(statusMsg);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
        statusMsg.remove();
    }, 5000);
}

async function prepareRobot() {
    prepareBtn.disabled = true;
    showStatus('Preparing robot...', 'info');
    
    try {
        const response = await fetch(`${API_URL}/prepare`, {
            method: 'POST'
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showStatus(data.message || 'Robot prepared successfully!', 'success');
            
            // Clear pathfinding output and start streaming
            pathfindingOutput = [];
            localStorage.setItem('pathfindingOutput', JSON.stringify(pathfindingOutput));
            outputDiv.innerHTML = '';
            outputSelector.value = 'pathfinding';
            currentSource = 'pathfinding';
            localStorage.setItem('currentSource', currentSource);
            startStreaming('pathfinding');
        } else {
            showStatus(data.error || 'Failed to prepare robot', 'error');
        }
    } catch (error) {
        showStatus(`Error: ${error.message}`, 'error');
    } finally {
        prepareBtn.disabled = false;
    }
}

async function startStrategy() {
    startBtn.disabled = true;
    showStatus('Starting strategy...', 'info');
    
    try {
        const response = await fetch(`${API_URL}/start`, {
            method: 'POST'
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showStatus(data.message || 'Strategy started successfully!', 'success');
            
            // Clear strategy output and start streaming
            strategyOutput = [];
            localStorage.setItem('strategyOutput', JSON.stringify(strategyOutput));
            outputDiv.innerHTML = '';
            outputSelector.value = 'strategy';
            currentSource = 'strategy';
            localStorage.setItem('currentSource', currentSource);
            startStreaming('strategy');
        } else {
            showStatus(data.error || 'Failed to start strategy', 'error');
        }
    } catch (error) {
        showStatus(`Error: ${error.message}`, 'error');
    } finally {
        startBtn.disabled = false;
    }
}

async function stopStrategy() {
    stopBtn.disabled = true;
    showStatus('Stopping strategy...', 'info');
    
    try {
        const response = await fetch(`${API_URL}/stop`, {
            method: 'POST'
        });
        
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            const text = await response.text();
            showStatus(`Server error: ${text}`, 'error');
            return;
        }
        
        const data = await response.json();
        
        if (response.ok) {
            showStatus(data.message || 'Strategy stopped successfully!', 'success');
        } else {
            showStatus(data.error || 'Failed to stop strategy', 'error');
        }
    } catch (error) {
        showStatus(`Error: ${error.message}`, 'error');
    } finally {
        stopBtn.disabled = false;
    }
}

async function testPami() {
    testPamiBtn.disabled = true;
    showStatus('Running PAMI test...', 'info');
    
    try {
        const response = await fetch(`${API_URL}/test_pami`, {
            method: 'POST'
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showStatus(data.message || 'PAMI test started!', 'success');
            
            // Clear PAMI output and start streaming
            pamiOutput = [];
            localStorage.setItem('pamiOutput', JSON.stringify(pamiOutput));
            outputDiv.innerHTML = '';
            outputSelector.value = 'pami';
            currentSource = 'pami';
            localStorage.setItem('currentSource', currentSource);
            startStreaming('pami');
        } else {
            showStatus(data.error || 'Failed to run PAMI test', 'error');
        }
    } catch (error) {
        showStatus(`Error: ${error.message}`, 'error');
    } finally {
        testPamiBtn.disabled = false;
    }
}

prepareBtn.addEventListener('click', prepareRobot);
startBtn.addEventListener('click', startStrategy);
stopBtn.addEventListener('click', stopStrategy);
testPamiBtn.addEventListener('click', testPami);

// ========== Settings Modal Functions ==========

// Open settings modal
settingsBtn.addEventListener('click', () => {
    updateSettingsDisplay();
    settingsModal.classList.add('show');
});

// Close settings modal
closeModal.addEventListener('click', () => {
    settingsModal.classList.remove('show');
});

// Close modal when clicking outside
window.addEventListener('click', (event) => {
    if (event.target === settingsModal) {
        settingsModal.classList.remove('show');
    }
});

// Update settings display
function updateSettingsDisplay() {
    const info = window.ipConfig.getConnectionInfo();
    
    // Show current mode
    if (info.isLocalhost) {
        currentModeSpan.textContent = 'Localhost (Development Mode)';
        currentModeSpan.style.color = '#ffa726';
    } else {
        currentModeSpan.textContent = 'Remote Access';
        currentModeSpan.style.color = '#4caf50';
    }
    
    // Show current IP
    currentIPSpan.textContent = info.currentIP;
    
    // Populate input with saved IP
    serverIPInput.value = info.savedIP;
}

// Save IP address
saveIPBtn.addEventListener('click', () => {
    const ip = serverIPInput.value.trim();
    
    try {
        window.ipConfig.saveIP(ip);
        showSettingsMessage('IP address saved! Reload the page to apply changes.', 'success');
        
        // Update display
        setTimeout(() => {
            location.reload();
        }, 1500);
    } catch (error) {
        showSettingsMessage(error.message, 'error');
    }
});

// Auto-detect IP
autoDetectBtn.addEventListener('click', async () => {
    showSettingsMessage('Scanning network...', 'info');
    
    try {
        // Try to ping common Raspberry Pi IPs
        const commonIPs = [
            '10.42.0.1',
            '192.168.1.100',
            '192.168.0.100',
            window.location.hostname
        ];
        
        for (const ip of commonIPs) {
            try {
                const response = await fetch(`http://${ip}:8000/strategies`, {
                    method: 'GET',
                    signal: AbortSignal.timeout(2000)
                });
                
                if (response.ok) {
                    serverIPInput.value = ip;
                    window.ipConfig.saveIP(ip);
                    showSettingsMessage(`Found server at ${ip}! Reload to apply.`, 'success');
                    
                    setTimeout(() => {
                        location.reload();
                    }, 1500);
                    return;
                }
            } catch (e) {
                // Continue to next IP
                continue;
            }
        }
        
        showSettingsMessage('Could not auto-detect server. Please enter IP manually.', 'error');
    } catch (error) {
        showSettingsMessage('Auto-detect failed: ' + error.message, 'error');
    }
});

function getSelectedStrategyName() {
    return fetch(`${API_URL}/selected_strategy`)
        .then(response => response.json())
        .then(data => {
            if (data.status === 'success') {
                return data.strategy || '-';
            } else {
                return '-';
            }
        });
}

function updateSelectedStrategyDisplay() {
    getSelectedStrategyName().then(name => {
        const strategySpan = document.getElementById('current-strategy');
        strategySpan.textContent = name;
    });
}

// Show settings message
function showSettingsMessage(message, type) {
    settingsMessage.textContent = message;
    settingsMessage.className = `settings-message ${type}`;
    settingsMessage.style.display = 'block';
    
    if (type !== 'info') {
        setTimeout(() => {
            settingsMessage.style.display = 'none';
        }, 5000);
    }
}

////////////////////////////////////
updateSelectedStrategyDisplay()