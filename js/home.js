// Use window.location.hostname to connect to the server hosting this page
const API_HOST = window.location.hostname || 'localhost';
const API_URL = `http://${API_HOST}:8000`;

const prepareBtn = document.getElementById('prepareBtn');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusDiv = document.getElementById('status');
const outputDiv = document.getElementById('output');
const outputSelector = document.getElementById('outputSelector');

let strategyEventSource = null;
let pathfindingEventSource = null;
let currentSource = 'strategy';

// Separate output buffers for each source - persist in localStorage
let strategyOutput = JSON.parse(localStorage.getItem('strategyOutput') || '[]');
let pathfindingOutput = JSON.parse(localStorage.getItem('pathfindingOutput') || '[]');

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

// Handle output source change
outputSelector.addEventListener('change', function() {
    currentSource = outputSelector.value;
    localStorage.setItem('currentSource', currentSource);
    displayCurrentOutput();
});

function displayCurrentOutput() {
    const outputs = currentSource === 'strategy' ? strategyOutput : pathfindingOutput;
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
    } else {
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

prepareBtn.addEventListener('click', prepareRobot);
startBtn.addEventListener('click', startStrategy);
stopBtn.addEventListener('click', stopStrategy);
