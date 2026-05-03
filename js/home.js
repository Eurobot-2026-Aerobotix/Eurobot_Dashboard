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
const restartMicroRosBtn = document.getElementById('restartMicroRosBtn');
const startWithPamiCheckbox = document.getElementById('startWithPamiCheckbox');
const statusDiv = document.getElementById('status');
const outputDiv = document.getElementById('output');
const outputSelector = document.getElementById('outputSelector');
const frontStatusDot = document.getElementById('frontStatusDot');
const backStatusDot = document.getElementById('backStatusDot');
const pneumaticStatusDot = document.getElementById('pneumaticStatusDot');
const beaconStatusDot = document.getElementById('beaconStatusDot');
const frontStatusLabel = document.getElementById('frontStatusLabel');
const backStatusLabel = document.getElementById('backStatusLabel');
const pneumaticStatusLabel = document.getElementById('pneumaticStatusLabel');
const beaconStatusLabel = document.getElementById('beaconStatusLabel');
const dashboardTitle = document.getElementById('dashboardTitle');

let strategyEventSource = null;
let pathfindingEventSource = null;
let pamiEventSource = null;
let currentSource = 'strategy';
let rosStatusConnection = null;
let rosReconnectTimeout = null;

const STATUS_TIMEOUT_MS = 2000;
const STATUS_CHECK_INTERVAL_MS = 500;
const ROS_RECONNECT_DELAY_MS = 3000;
const START_WITH_PAMI_STORAGE_KEY = 'startWithPamiEnabled';

const espStatusState = {
    front: {
        dot: frontStatusDot,
        label: frontStatusLabel,
        lastMessageAt: 0,
        connected: false,
        topic: null,
        mode: 'heartbeat'
    },
    back: {
        dot: backStatusDot,
        label: backStatusLabel,
        lastMessageAt: 0,
        connected: false,
        topic: null,
        mode: 'heartbeat'
    },
    pneumatic: {
        dot: pneumaticStatusDot,
        label: pneumaticStatusLabel,
        lastMessageAt: 0,
        connected: false,
        topic: null,
        mode: 'heartbeat'
    },
    beacon: {
        dot: beaconStatusDot,
        label: beaconStatusLabel,
        lastMessageAt: 0,
        connected: false,
        topic: null,
        mode: 'value'
    }
};

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

const savedStartWithPami = localStorage.getItem(START_WITH_PAMI_STORAGE_KEY);
if (startWithPamiCheckbox && savedStartWithPami !== null) {
    startWithPamiCheckbox.checked = savedStartWithPami === 'true';
}

if (startWithPamiCheckbox) {
    startWithPamiCheckbox.addEventListener('change', function() {
        localStorage.setItem(START_WITH_PAMI_STORAGE_KEY, String(startWithPamiCheckbox.checked));
    });
}

if (dashboardTitle) {
    dashboardTitle.addEventListener('click', () => {
        document.body.classList.add('eurobot-background');
    });
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

function isNearBottom(element, threshold = 24) {
    const distanceFromBottom = element.scrollHeight - (element.scrollTop + element.clientHeight);
    return distanceFromBottom <= threshold;
}

function appendOutputLine(lineText) {
    const shouldStickToBottom = isNearBottom(outputDiv);

    const line = document.createElement('div');
    line.className = 'output-line';
    line.textContent = lineText;
    outputDiv.appendChild(line);

    // Only auto-scroll when user is already at (or near) bottom.
    // If user scrolled up to read logs, keep viewport fixed.
    if (shouldStickToBottom) {
        outputDiv.scrollTop = outputDiv.scrollHeight;
    }
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
                appendOutputLine(event.data);
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
                appendOutputLine(event.data);
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
                appendOutputLine(event.data);
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

function setEspConnectionState(key, isConnected, customLabel = null) {
    const entry = espStatusState[key];
    if (!entry) {
        return;
    }

    entry.connected = isConnected;
    entry.dot.classList.toggle('connected', isConnected);
    entry.dot.classList.toggle('disconnected', !isConnected);
    entry.label.textContent = customLabel ?? (isConnected ? 'Connected' : 'Disconnected');
}

function markEspMessageReceived(key) {
    const entry = espStatusState[key];
    if (!entry) {
        return;
    }

    entry.lastMessageAt = Date.now();
    setEspConnectionState(key, true);
}

function setBeaconReadyState(isReady) {
    setEspConnectionState('beacon', isReady, isReady ? 'Ready' : 'Not Ready');
}

function markBeaconMessageReceived(message) {
    const value = Number(message?.data ?? 0);
    espStatusState.beacon.lastMessageAt = Date.now();
    setBeaconReadyState(value === 1);
}

function createStatusSubscription(key, topicName, onMessage = null, messageType = 'std_msgs/msg/Int64') {
    const entry = espStatusState[key];
    if (!rosStatusConnection || !entry) {
        return null;
    }

    const topic = new ROSLIB.Topic({
        ros: rosStatusConnection,
        name: topicName,
        messageType
    });

    topic.subscribe((message) => {
        if (onMessage) {
            onMessage(message);
            return;
        }

        markEspMessageReceived(key);
    });

    entry.topic = topic;
    return topic;
}

function subscribeFrontStatus() {
    return createStatusSubscription('front', '/front/status');
}

function subscribeBackStatus() {
    return createStatusSubscription('back', '/back/status');
}

function subscribePneumaticStatus() {
    return createStatusSubscription('pneumatic', '/pneumatic/status');
}

function subscribeBeaconStatus() {
    return createStatusSubscription('beacon', '/web/beacon_status', markBeaconMessageReceived, 'std_msgs/msg/Int32');
}

function disconnectAllEspTopics() {
    Object.entries(espStatusState).forEach(([key, entry]) => {
        if (entry.topic) {
            try {
                entry.topic.unsubscribe();
            } catch (error) {
                console.warn('Failed to unsubscribe ESP status topic:', error);
            }
            entry.topic = null;
        }

        entry.lastMessageAt = 0;

        if (entry.mode === 'value' && key === 'beacon') {
            setBeaconReadyState(false);
            return;
        }

        setEspConnectionState(key, false);
    });
}

function scheduleRosReconnect() {
    if (rosReconnectTimeout) {
        return;
    }

    rosReconnectTimeout = setTimeout(() => {
        rosReconnectTimeout = null;
        initializeEspStatusMonitoring();
    }, ROS_RECONNECT_DELAY_MS);
}

function initializeEspStatusMonitoring() {
    if (typeof ROSLIB === 'undefined') {
        console.error('ROSLIB is not available on the home page');
        return;
    }

    if (rosStatusConnection) {
        try {
            rosStatusConnection.close();
        } catch (error) {
            console.warn('Failed to close previous ROS connection:', error);
        }
    }

    disconnectAllEspTopics();

    rosStatusConnection = new ROSLIB.Ros({
        url: window.ipConfig.getWebSocketURL()
    });

    rosStatusConnection.on('connection', () => {
        console.log('Connected to ROS bridge for ESP status monitoring');
        subscribeFrontStatus();
        subscribeBackStatus();
        subscribePneumaticStatus();
        subscribeBeaconStatus();
    });

    rosStatusConnection.on('error', (error) => {
        console.error('ROS bridge error:', error);
        disconnectAllEspTopics();
        scheduleRosReconnect();
    });

    rosStatusConnection.on('close', () => {
        console.warn('ROS bridge closed for ESP status monitoring');
        disconnectAllEspTopics();
        scheduleRosReconnect();
    });
}

setInterval(() => {
    const now = Date.now();

    Object.entries(espStatusState).forEach(([key, entry]) => {
        if (entry.mode !== 'heartbeat') {
            return;
        }

        if (entry.lastMessageAt === 0) {
            setEspConnectionState(key, false);
            return;
        }

        const isFresh = (now - entry.lastMessageAt) <= STATUS_TIMEOUT_MS;
        setEspConnectionState(key, isFresh);
    });
}, STATUS_CHECK_INTERVAL_MS);

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
    const publishPami = Boolean(startWithPamiCheckbox && startWithPamiCheckbox.checked);
    showStatus(`Starting strategy${publishPami ? ' with PAMI' : ''}...`, 'info');
    
    try {
        // Add timeout to prevent hanging forever
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch(`${API_URL}/start`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ publish_pami: publishPami }),
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

async function restartMicroRos() {
    restartMicroRosBtn.disabled = true;
    
    showStatus('Restarting MicroROS agents...', 'info');
    
    try {
        // Add timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch(`${API_URL}/restart_microros`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            const text = await response.text();
            showStatus(`Server error: ${text}`, 'error');
            restartMicroRosBtn.disabled = false;
            return;
        }
        
        const data = await response.json();
        
        if (response.ok) {
            showStatus(data.message || 'MicroROS service restarted successfully!', 'success');
        } else {
            showStatus(data.error || 'Failed to restart MicroROS service', 'error');
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            showStatus('Request timeout - could not reach server.', 'error');
        } else {
            showStatus(`Error: ${error.message}`, 'error');
        }
    } finally {
        restartMicroRosBtn.disabled = false;
    }
}

prepareBtn.addEventListener('click', prepareRobot);
startBtn.addEventListener('click', startStrategy);
stopBtn.addEventListener('click', stopStrategy);
restartMicroRosBtn.addEventListener('click', restartMicroRos);

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
initializeEspStatusMonitoring();

window.addEventListener('beforeunload', () => {
    if (rosReconnectTimeout) {
        clearTimeout(rosReconnectTimeout);
        rosReconnectTimeout = null;
    }

    disconnectAllEspTopics();

    if (rosStatusConnection) {
        try {
            rosStatusConnection.close();
        } catch (error) {
            console.warn('Failed to close ROS bridge on unload:', error);
        }
    }
});