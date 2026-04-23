const ROSBRIDGE_URL = window.ipConfig ? window.ipConfig.getWebSocketURL() : 'ws://localhost:9090';
const API_URL = window.ipConfig ? window.ipConfig.getAPIURL() : `${window.location.protocol}//${window.location.host}`;

const rosStatus = document.getElementById('rosStatus');
const rosStatusText = document.getElementById('rosStatusText');
const espTargetSelect = document.getElementById('espTargetSelect');
const pneumaticTargetSelect = document.getElementById('pneumaticTargetSelect');
const n20ValueInput = document.getElementById('n20ValueInput');
const sendN20Btn = document.getElementById('sendN20Btn');
const pumpBtn = document.getElementById('pumpBtn');
const disablePumpBtn = document.getElementById('disablePumpBtn');
const resetBeaconBtn = document.getElementById('resetBeaconBtn');
const clearMapBtn = document.getElementById('clearMapBtn');
const updateMapBtn = document.getElementById('updateMapBtn');
const testMapBtn = document.getElementById('testMapBtn');
const clearLogBtn = document.getElementById('clearLogBtn');
const commandStatus = document.getElementById('commandStatus');
const commandLog = document.getElementById('commandLog');
const testPamiBtn = document.getElementById('testPamiBtn');
const testPamiStrategyInfo = document.getElementById('testPamiStrategyInfo');
const testPamiCheckboxes = document.querySelectorAll('.test-pami-checkbox');
const clearPamiOutputBtn = document.getElementById('clearPamiOutputBtn');
const outputDiv = document.getElementById('output');

let ros = null;
let reconnectTimeout = null;
let webTestCommandTopic = null;
let webTestResultTopic = null;
let commandCounter = 0;
const seenAckRequestIds = new Set();
let pamiEventSource = null;
let pamiOutput = [];
const MAX_OUTPUT_LINES = 1000;

try {
    pamiOutput = JSON.parse(localStorage.getItem('pamiOutput') || '[]');
    if (!Array.isArray(pamiOutput)) {
        pamiOutput = [];
    }
} catch {
    pamiOutput = [];
}

function isNearBottom(element, threshold = 24) {
    const distanceFromBottom = element.scrollHeight - (element.scrollTop + element.clientHeight);
    return distanceFromBottom <= threshold;
}

function appendOutputLine(text) {
    if (!outputDiv) return;

    const shouldStickToBottom = isNearBottom(outputDiv);
    const line = document.createElement('div');
    line.className = 'output-line';
    line.textContent = text;
    outputDiv.appendChild(line);

    if (shouldStickToBottom) {
        outputDiv.scrollTop = outputDiv.scrollHeight;
    }
}

function renderPamiOutput() {
    if (!outputDiv) return;
    outputDiv.innerHTML = '';
    pamiOutput.forEach((line) => appendOutputLine(line));
    outputDiv.scrollTop = outputDiv.scrollHeight;
}

function startPamiOutputStreaming() {
    if (!outputDiv) return;

    if (pamiEventSource) {
        pamiEventSource.close();
        pamiEventSource = null;
    }

    pamiEventSource = new EventSource(`${API_URL}/stream/pami`);

    pamiEventSource.onmessage = (event) => {
        pamiOutput.push(event.data);
        if (pamiOutput.length > MAX_OUTPUT_LINES) {
            pamiOutput = pamiOutput.slice(-MAX_OUTPUT_LINES);
        }

        try {
            localStorage.setItem('pamiOutput', JSON.stringify(pamiOutput));
        } catch {
            // Ignore localStorage quota errors.
        }

        appendOutputLine(event.data);
    };
}

function nextRequestId() {
    commandCounter += 1;
    return `test-${Date.now()}-${commandCounter}`;
}

function updateRosStatus(connected) {
    rosStatus.classList.toggle('connected', connected);
    rosStatus.classList.toggle('disconnected', !connected);
    rosStatusText.textContent = connected ? 'Connected' : 'Disconnected';
}

function setCommandStatus(message, type = 'info') {
    if (!commandStatus) {
        return;
    }
    commandStatus.textContent = message;
    commandStatus.className = `command-status ${type}`;
}

function addLogLine(text) {
    if (!commandLog) {
        return;
    }
    const line = document.createElement('div');
    line.className = 'log-line';
    line.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
    commandLog.prepend(line);
}

function ensureConnection() {
    if (!ros || !webTestCommandTopic) {
        throw new Error('ROS bridge is not connected');
    }
}

function getSelectedPamisFromCheckboxes() {
    const selected = [];
    testPamiCheckboxes.forEach((checkbox) => {
        if (checkbox.checked) {
            selected.push(checkbox.value);
        }
    });
    return selected;
}

function persistPamiSelection() {
    const selected = getSelectedPamisFromCheckboxes();
    if (selected.length > 0) {
        localStorage.setItem('pami_test_numbers', selected.join(','));
    } else {
        localStorage.removeItem('pami_test_numbers');
    }
}

function applyPamiSelectionFromStorage() {
    if (!testPamiCheckboxes.length) {
        return;
    }

    const raw = localStorage.getItem('pami_test_numbers');
    if (!raw) {
        testPamiCheckboxes.forEach((checkbox) => {
            checkbox.checked = true;
        });
        persistPamiSelection();
        return;
    }

    const selected = new Set(raw.split(',').map(v => v.trim()).filter(Boolean));
    testPamiCheckboxes.forEach((checkbox) => {
        checkbox.checked = selected.has(checkbox.value);
    });
}

function refreshTestPamiStrategyInfo() {
    const strategyName = localStorage.getItem('pami_test_strategy_name');
    const strategyPath = localStorage.getItem('pami_test_strategy_path');
    const display = strategyName || strategyPath || 'not selected';
    if (testPamiStrategyInfo) {
        testPamiStrategyInfo.textContent = `Strategy: ${display}`;
    }
}

async function runPamiTest() {
    if (!testPamiBtn) return;

    testPamiBtn.disabled = true;

    const testStrategyPath = localStorage.getItem('pami_test_strategy_path');
    const testStrategyName = localStorage.getItem('pami_test_strategy_name');
    const selectedPamis = getSelectedPamisFromCheckboxes();

    setCommandStatus(
        `Starting PAMI test${selectedPamis.length ? ` (PAMIs: ${selectedPamis.join(',')})` : ' (all PAMIs)' }...`,
        'info'
    );

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const requestBody = {};
        if (testStrategyPath) requestBody.strategy_path = testStrategyPath;
        if (testStrategyName) requestBody.strategy_name = testStrategyName;
        if (selectedPamis.length) requestBody.pami_numbers = selectedPamis.join(',');

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
            throw new Error(`Server error: ${text}`);
        }

        const data = await response.json();
        if (response.ok) {
            setCommandStatus(data.message || 'PAMI test started.', 'success');
            addLogLine(`PAMI test started${selectedPamis.length ? ` [${selectedPamis.join(',')}]` : ' [all]'}`);

            // Reset output view for a fresh test session.
            pamiOutput = [];
            localStorage.setItem('pamiOutput', JSON.stringify(pamiOutput));
            renderPamiOutput();
            startPamiOutputStreaming();
        } else {
            throw new Error(data.error || 'Failed to run PAMI test');
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            setCommandStatus('Request timeout while starting PAMI test.', 'error');
            addLogLine('ERROR: Request timeout while starting PAMI test.');
        } else {
            setCommandStatus(error.message, 'error');
            addLogLine(`ERROR: ${error.message}`);
        }
    } finally {
        testPamiBtn.disabled = false;
    }
}

function publishWebHandlerCommand(payload, logText) {
    try {
        ensureConnection();

        const requestId = nextRequestId();
        const payloadWithId = {
            ...payload,
            request_id: requestId
        };

        webTestCommandTopic.publish(new ROSLIB.Message({
            data: JSON.stringify(payloadWithId)
        }));

        setCommandStatus('Command sent to web_handler.', 'info');
        addLogLine(`${logText} [id=${requestId}]`);
    } catch (error) {
        setCommandStatus(error.message, 'error');
        addLogLine(`ERROR: ${error.message}`);
    }
}

function publishEspAction(actionName, value) {
    const side = espTargetSelect.value;
    publishWebHandlerCommand(
        {
            controller: side,
            action: actionName,
            value
        },
        `/web/test_controller -> ${side}.${actionName}(${value})`
    );
}

function sendN20Command() {
    const rawValue = n20ValueInput.value.trim();
    if (rawValue === '') {
        setCommandStatus('Enter an Int32 value for n20.', 'error');
        return;
    }

    const value = Number.parseInt(rawValue, 10);
    if (Number.isNaN(value)) {
        setCommandStatus('Invalid n20 value.', 'error');
        return;
    }

    publishEspAction('n20', value);
}

function sendPneumaticCommand(disable = false) {
    const side = pneumaticTargetSelect.value;
    const action = disable ? 'disable_pump' : 'pump';
    publishWebHandlerCommand(
        {
            controller: 'pneumatic',
            side,
            action
        },
        `/web/test_controller -> pneumatic.${action}(${side})`
    );
}

function sendHybridAstarCommand(action, label) {
    publishWebHandlerCommand(
        {
            controller: 'hybrid_astar',
            action
        },
        `/web/test_controller -> hybrid_astar.${label}`
    );
}

function initializeRos() {
    if (ros) {
        try {
            ros.close();
        } catch (error) {
            console.warn('Failed to close previous ROS connection:', error);
        }
    }

    ros = new ROSLIB.Ros({ url: ROSBRIDGE_URL });

    ros.on('connection', () => {
        webTestCommandTopic = new ROSLIB.Topic({
            ros,
            name: '/web/test_controller',
            messageType: 'std_msgs/String'
        });

        webTestResultTopic = new ROSLIB.Topic({
            ros,
            name: '/web/test_controller_result',
            messageType: 'std_msgs/String'
        });

        webTestResultTopic.subscribe((message) => {
            try {
                const result = JSON.parse(message.data);
                const requestId = result.request_id;

                // Guard against duplicate ACKs from duplicate backend subscribers
                if (requestId && seenAckRequestIds.has(requestId)) {
                    return;
                }

                if (requestId) {
                    seenAckRequestIds.add(requestId);
                    if (seenAckRequestIds.size > 500) {
                        const first = seenAckRequestIds.values().next().value;
                        seenAckRequestIds.delete(first);
                    }
                }

                if (result.success) {
                    setCommandStatus(result.message || 'Command executed.', 'success');
                    const handlerTag = result.handler_instance ? ` [handler=${result.handler_instance}]` : '';
                    addLogLine(`ACK: ${result.message}${requestId ? ` [id=${requestId}]` : ''}${handlerTag}`);
                } else {
                    setCommandStatus(result.message || 'Command failed.', 'error');
                    const handlerTag = result.handler_instance ? ` [handler=${result.handler_instance}]` : '';
                    addLogLine(`ERROR: ${result.message}${requestId ? ` [id=${requestId}]` : ''}${handlerTag}`);
                }
            } catch (error) {
                setCommandStatus('Invalid response from web_handler.', 'error');
                addLogLine(`ERROR: Invalid response - ${error.message}`);
            }
        });

        updateRosStatus(true);
        setCommandStatus('ROS bridge connected. TEST commands go through web_handler.', 'success');
        addLogLine(`Connected to ${ROSBRIDGE_URL}`);
    });

    ros.on('error', (error) => {
        console.error('ROS bridge error:', error);
        updateRosStatus(false);
        setCommandStatus('ROS bridge error. Retrying automatically...', 'error');
    });

    ros.on('close', () => {
        webTestCommandTopic = null;
        webTestResultTopic = null;
        updateRosStatus(false);
        setCommandStatus('ROS bridge disconnected. Retrying in 3s...', 'error');
        if (!reconnectTimeout) {
            reconnectTimeout = window.setTimeout(() => {
                reconnectTimeout = null;
                initializeRos();
            }, 3000);
        }
    });
}

document.querySelectorAll('.action-btn[data-action]').forEach((button) => {
    button.addEventListener('click', () => {
        publishEspAction(button.dataset.action, Number.parseInt(button.dataset.value, 10));
    });
});

sendN20Btn.addEventListener('click', sendN20Command);
n20ValueInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        sendN20Command();
    }
});

pumpBtn.addEventListener('click', () => sendPneumaticCommand(false));
disablePumpBtn.addEventListener('click', () => sendPneumaticCommand(true));

if (resetBeaconBtn) {
    resetBeaconBtn.addEventListener('click', () => sendHybridAstarCommand('reset_beacon', 'reset_beacon()'));
}

if (clearMapBtn) {
    clearMapBtn.addEventListener('click', () => sendHybridAstarCommand('clear_map', 'clear_map()'));
}

if (updateMapBtn) {
    updateMapBtn.addEventListener('click', () => sendHybridAstarCommand('update_map', 'update_map()'));
}

if (testMapBtn) {
    testMapBtn.addEventListener('click', () => sendHybridAstarCommand('test_map', 'test_map()'));
}

if (clearLogBtn && commandLog) {
    clearLogBtn.addEventListener('click', () => {
        commandLog.innerHTML = '';
        setCommandStatus('Command log cleared.', 'info');
    });
}

if (clearPamiOutputBtn) {
    clearPamiOutputBtn.addEventListener('click', () => {
        pamiOutput = [];
        localStorage.setItem('pamiOutput', JSON.stringify(pamiOutput));
        renderPamiOutput();
    });
}

if (testPamiBtn) {
    testPamiBtn.addEventListener('click', runPamiTest);
}

applyPamiSelectionFromStorage();
testPamiCheckboxes.forEach((checkbox) => {
    checkbox.addEventListener('change', persistPamiSelection);
});
refreshTestPamiStrategyInfo();
renderPamiOutput();
startPamiOutputStreaming();

window.addEventListener('beforeunload', () => {
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }

    if (ros) {
        try {
            ros.close();
        } catch (error) {
            console.warn('Failed to close ROS bridge on unload:', error);
        }
    }

    if (pamiEventSource) {
        pamiEventSource.close();
        pamiEventSource = null;
    }
});

initializeRos();