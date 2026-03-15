const ROSBRIDGE_URL = window.ipConfig ? window.ipConfig.getWebSocketURL() : 'ws://localhost:9090';

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
const clearLogBtn = document.getElementById('clearLogBtn');
const commandStatus = document.getElementById('commandStatus');
const commandLog = document.getElementById('commandLog');

let ros = null;
let reconnectTimeout = null;
let webTestCommandTopic = null;
let webTestResultTopic = null;
let commandCounter = 0;
const seenAckRequestIds = new Set();

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
    commandStatus.textContent = message;
    commandStatus.className = `command-status ${type}`;
}

function addLogLine(text) {
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

clearLogBtn.addEventListener('click', () => {
    commandLog.innerHTML = '';
    setCommandStatus('Command log cleared.', 'info');
});

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
});

initializeRos();