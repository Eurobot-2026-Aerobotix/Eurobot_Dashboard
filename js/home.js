// Use the smart IP configuration
const API_URL = window.ipConfig.getAPIURL();

// Settings Modal Elements
const saveBtn = document.getElementById('saveBtn');
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
// Limit size to prevent memory issues (keep last 1000 lines)
const MAX_OUTPUT_LINES = 1000;

function loadOutput(key) {
    try {
        const data = JSON.parse(localStorage.getItem(key) || '[]');
        return data.slice(-MAX_OUTPUT_LINES); // Keep only last 1000 lines
    } catch (e) {
        console.error(`Failed to load ${key} from localStorage:`, e);
        localStorage.removeItem(key); // Clear corrupted data
        return [];
    }
}

let strategyOutput = loadOutput('strategyOutput');
let pathfindingOutput = loadOutput('pathfindingOutput');
let pamiOutput = loadOutput('pamiOutput');

// Load saved current source
const savedSource = localStorage.getItem('currentSource');
if (savedSource) {
    currentSource = savedSource;
    outputSelector.value = savedSource;
}

// Display existing output on page load
displayCurrentOutput();

// Auto-reconnect to current stream only (not all streams) to conserve connections
if (currentSource === 'strategy' && strategyOutput.length > 0) {
    startStreaming('strategy');
} else if (currentSource === 'pathfinding' && pathfindingOutput.length > 0) {
    startStreaming('pathfinding');
} else if (currentSource === 'pami' && pamiOutput.length > 0) {
    startStreaming('pami');
}

// Handle output source change
outputSelector.addEventListener('change', function() {
    currentSource = outputSelector.value;
    localStorage.setItem('currentSource', currentSource);
    
    // Close EventSources for sources we're not viewing to free up connections
    if (currentSource !== 'strategy' && strategyEventSource) {
        console.log('Closing strategy EventSource (not viewing)');
        strategyEventSource.close();
        strategyEventSource = null;
    }
    if (currentSource !== 'pathfinding' && pathfindingEventSource) {
        console.log('Closing pathfinding EventSource (not viewing)');
        pathfindingEventSource.close();
        pathfindingEventSource = null;
    }
    if (currentSource !== 'pami' && pamiEventSource) {
        console.log('Closing pami EventSource (not viewing)');
        pamiEventSource.close();
        pamiEventSource = null;
    }
    
    // Start streaming for the selected source if it has output
    if (currentSource === 'strategy' && strategyOutput.length > 0 && !strategyEventSource) {
        startStreaming('strategy');
    } else if (currentSource === 'pathfinding' && pathfindingOutput.length > 0 && !pathfindingEventSource) {
        startStreaming('pathfinding');
    } else if (currentSource === 'pami' && pamiOutput.length > 0 && !pamiEventSource) {
        startStreaming('pami');
    }
    
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
    console.log('Starting stream for:', source);
    
    if (source === 'strategy') {
        if (strategyEventSource) {
            console.log('Closing existing strategy EventSource');
            strategyEventSource.close();
            strategyEventSource = null;
        }
        
        strategyEventSource = new EventSource(`${API_URL}/stream/strategy`);
        
        strategyEventSource.onmessage = function(event) {
            strategyOutput.push(event.data);
            // Limit array size to prevent memory overflow
            if (strategyOutput.length > MAX_OUTPUT_LINES) {
                strategyOutput = strategyOutput.slice(-MAX_OUTPUT_LINES);
            }
            try {
                localStorage.setItem('strategyOutput', JSON.stringify(strategyOutput));
            } catch (e) {
                console.error('localStorage quota exceeded, clearing old data');
                strategyOutput = strategyOutput.slice(-500); // Keep fewer lines
                localStorage.setItem('strategyOutput', JSON.stringify(strategyOutput));
            }
            
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
            // Auto-reconnect after 3 seconds if connection drops
            if (strategyEventSource.readyState === EventSource.CLOSED) {
                console.log('Strategy stream closed, reconnecting in 3s...');
                setTimeout(() => {
                    if (currentSource === 'strategy') {
                        startStreaming('strategy');
                    }
                }, 3000);
            }
        };
    } else if (source === 'pathfinding') {
        if (pathfindingEventSource) {
            console.log('Closing existing pathfinding EventSource');
            pathfindingEventSource.close();
            pathfindingEventSource = null;
        }
        
        pathfindingEventSource = new EventSource(`${API_URL}/stream/pathfinding`);
        
        pathfindingEventSource.onmessage = function(event) {
            pathfindingOutput.push(event.data);
            if (pathfindingOutput.length > MAX_OUTPUT_LINES) {
                pathfindingOutput = pathfindingOutput.slice(-MAX_OUTPUT_LINES);
            }
            try {
                localStorage.setItem('pathfindingOutput', JSON.stringify(pathfindingOutput));
            } catch (e) {
                console.error('localStorage quota exceeded');
                pathfindingOutput = pathfindingOutput.slice(-500);
                localStorage.setItem('pathfindingOutput', JSON.stringify(pathfindingOutput));
            }
            
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
            if (pathfindingEventSource.readyState === EventSource.CLOSED) {
                console.log('Pathfinding stream closed, reconnecting in 3s...');
                setTimeout(() => {
                    if (currentSource === 'pathfinding') {
                        startStreaming('pathfinding');
                    }
                }, 3000);
            }
        };
    } else if (source === 'pami') {
        if (pamiEventSource) {
            console.log('Closing existing pami EventSource');
            pamiEventSource.close();
            pamiEventSource = null;
        }
        
        pamiEventSource = new EventSource(`${API_URL}/stream/pami`);
        
        pamiEventSource.onmessage = function(event) {
            pamiOutput.push(event.data);
            if (pamiOutput.length > MAX_OUTPUT_LINES) {
                pamiOutput = pamiOutput.slice(-MAX_OUTPUT_LINES);
            }
            try {
                localStorage.setItem('pamiOutput', JSON.stringify(pamiOutput));
            } catch (e) {
                console.error('localStorage quota exceeded');
                pamiOutput = pamiOutput.slice(-500);
                localStorage.setItem('pamiOutput', JSON.stringify(pamiOutput));
            }
            
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
            if (pamiEventSource.readyState === EventSource.CLOSED) {
                console.log('PAMI stream closed, reconnecting in 3s...');
                setTimeout(() => {
                    if (currentSource === 'pami') {
                        startStreaming('pami');
                    }
                }, 3000);
            }
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
        // Add timeout to prevent hanging
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch(`${API_URL}/prepare`, {
            method: 'POST',
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        const data = await response.json();
        
        if (response.ok) {
            showStatus(data.message || 'Robot prepared successfully!', 'success');
            
            // Clear pathfinding output and start streaming
            pathfindingOutput = [];
            try {
                localStorage.setItem('pathfindingOutput', JSON.stringify(pathfindingOutput));
            } catch (e) {
                console.error('localStorage error:', e);
            }
            outputDiv.innerHTML = '';
            outputSelector.value = 'pathfinding';
            currentSource = 'pathfinding';
            localStorage.setItem('currentSource', currentSource);
            startStreaming('pathfinding');
        } else {
            showStatus(data.error || 'Failed to prepare robot', 'error');
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            showStatus('Request timeout - too many open connections. Try refreshing the page.', 'error');
        } else {
            showStatus(`Error: ${error.message}`, 'error');
        }
    } finally {
        prepareBtn.disabled = false;
    }
}

async function startStrategy() {
    startBtn.disabled = true;
    showStatus('Starting strategy...', 'info');
    
    try {
        // Add timeout to prevent hanging forever
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch(`${API_URL}/start`, {
            method: 'POST',
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        const data = await response.json();
        
        if (response.ok) {
            showStatus(data.message || 'Strategy started successfully!', 'success');
            
            // Clear strategy output and start streaming
            strategyOutput = [];
            try {
                localStorage.setItem('strategyOutput', JSON.stringify(strategyOutput));
            } catch (e) {
                console.error('localStorage error:', e);
            }
            outputDiv.innerHTML = '';
            outputSelector.value = 'strategy';
            currentSource = 'strategy';
            localStorage.setItem('currentSource', currentSource);
            startStreaming('strategy');
        } else {
            showStatus(data.error || 'Failed to start strategy', 'error');
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            showStatus('Request timeout - too many open connections. Try refreshing the page.', 'error');
        } else {
            showStatus(`Error: ${error.message}`, 'error');
        }
    } finally {
        startBtn.disabled = false;
    }
}

async function stopStrategy() {
    stopBtn.disabled = true;
    showStatus('Stopping strategy...', 'info');
    
    try {
        // Add timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch(`${API_URL}/stop`, {
            method: 'POST',
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        
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
        if (error.name === 'AbortError') {
            showStatus('Request timeout - too many open connections. Try refreshing the page.', 'error');
        } else {
            showStatus(`Error: ${error.message}`, 'error');
        }
    } finally {
        stopBtn.disabled = false;
    }
}

async function testPami() {
    testPamiBtn.disabled = true;
    
    // Check if a test strategy was saved
    const testStrategyPath = localStorage.getItem('pami_test_strategy_path');
    const testStrategyName = localStorage.getItem('pami_test_strategy_name');
    
    if (testStrategyPath) {
        showStatus(`Running PAMI test with: ${testStrategyName}`, 'info');
    } else {
        showStatus('Running PAMI test...', 'info');
    }
    
    try {
        // Add timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const requestBody = testStrategyPath ? { strategy_path: testStrategyPath } : {};
        
        const response = await fetch(`${API_URL}/test_pami`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            const text = await response.text();
            showStatus(`Server error: ${text}`, 'error');
            testPamiBtn.disabled = false;
            return;
        }
        
        const data = await response.json();
        
        if (response.ok) {
            showStatus(data.message || 'PAMI test started!', 'success');
            
            // Clear PAMI output and start streaming
            pamiOutput = [];
            try {
                localStorage.setItem('pamiOutput', JSON.stringify(pamiOutput));
            } catch (e) {
                console.error('localStorage error:', e);
            }
            outputDiv.innerHTML = '';
            outputSelector.value = 'pami';
            currentSource = 'pami';
            localStorage.setItem('currentSource', currentSource);
            startStreaming('pami');
        } else {
            showStatus(data.error || 'Failed to run PAMI test', 'error');
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            showStatus('Request timeout - too many open connections. Try refreshing the page.', 'error');
        } else {
            showStatus(`Error: ${error.message}`, 'error');
        }
    } finally {
        testPamiBtn.disabled = false;
    }
}

prepareBtn.addEventListener('click', prepareRobot);
startBtn.addEventListener('click', startStrategy);
stopBtn.addEventListener('click', stopStrategy);
testPamiBtn.addEventListener('click', testPami);

// ========== Settings Modal Functions ==========

// Save & Commit button
saveBtn.addEventListener('click', async () => {
    const commitMessage = prompt('Enter commit message:');
    if (!commitMessage || !commitMessage.trim()) {
        return;
    }
    
    saveBtn.disabled = true;
    showStatus('Saving and committing changes...', 'info');
    
    try {
        const response = await fetch(`${API_URL}/git_commit`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: commitMessage.trim()
            })
        });
        
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            const text = await response.text();
            showStatus(`Server error: ${text}`, 'error');
            saveBtn.disabled = false;
            return;
        }
        
        const data = await response.json();
        
        if (response.ok) {
            showStatus(data.message || 'Changes committed successfully!', 'success');
        } else {
            showStatus(data.error || 'Failed to commit changes', 'error');
        }
    } catch (error) {
        showStatus(`Error: ${error.message}`, 'error');
    } finally {
        saveBtn.disabled = false;
    }
});

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