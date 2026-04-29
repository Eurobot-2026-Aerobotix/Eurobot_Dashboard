// Configuration
const MAP_WIDTH_MM = 3000;  // 3000mm = 3m
const MAP_HEIGHT_MM = 2000; // 2000mm = 2m
const ROBOT_SIZE_MM = 300;  // 300mm = 0.3m (robot is 0.3m x 0.3m)

// ROS2 Bridge Configuration - use smart IP config
const ROSBRIDGE_URL = window.ipConfig ? window.ipConfig.getWebSocketURL() : 'ws://localhost:9090';
const API_URL = window.ipConfig ? window.ipConfig.getAPIURL() : 'http://localhost:5000';

let ros = null;
let isConnected = false;

// State
let robotPose = { x: 0, y: 0, theta: 0 };
let obstacles = [];
let enemyRobot = null;  // Track enemy robot position
let enemyRobotSpeed = { vx: 0, vy: 0, updatedAt: 0 };  // Enemy velocity in map frame (m/s)
let robotMarker = null;
let enemyRobotMarker = null;  // Marker for enemy robot
let enemySpeedArrow = null;
let lastUpdateTime = null;
let trailEnabled = true;
let maxTrailPoints = 50;
let currentPath = [];  // Store current planned path from hybrid A*
let pathHistory = [];  // Store all paths for current game (cleared on /clear_map)

// Distinct colors by draw order (first path, second path, ...)
const PATH_COLORS = [
    '#00ff00', // 1
    '#ff3b30', // 2
    '#007aff', // 3
    '#ff9500', // 4
    '#af52de', // 5
    '#00c7be', // 6
    '#ff2d55', // 7
    '#8e8e93'  // 8
];

// Throttling for enemy robot updates (prevent browser lag from high-frequency lidar data)
let lastEnemyUpdateTime = 0;
const ENEMY_UPDATE_THROTTLE_MS = 100;  // Update enemy display max once every 100ms (10Hz)
const ENEMY_SPEED_STALE_MS = 750;
const ENEMY_SPEED_MIN_MPS = 0.05;

// DOM Elements
const mapWrapper = document.getElementById('mapWrapper');
const map = document.getElementById('map');
const rosStatus = document.getElementById('rosStatus');
const statusText = document.getElementById('statusText');
const robotXDisplay = document.getElementById('robotX');
const robotYDisplay = document.getElementById('robotY');
const robotThetaDisplay = document.getElementById('robotTheta');
const obstacleCountDisplay = document.getElementById('obstacleCount');
const lastUpdateDisplay = document.getElementById('lastUpdate');
const schedulerSourceDisplay = document.getElementById('schedulerSource');
const schedulerRemainingDisplay = document.getElementById('schedulerRemaining');
const schedulerFrontEmptyDisplay = document.getElementById('schedulerFrontEmpty');
const schedulerBackEmptyDisplay = document.getElementById('schedulerBackEmpty');
const schedulerTrackedTaskDisplay = document.getElementById('schedulerTrackedTask');
const schedulerQueueSizeDisplay = document.getElementById('schedulerQueueSize');
const schedulerQueueList = document.getElementById('schedulerQueueList');
const restartBeaconBtn = document.getElementById('restartBeaconBtn');
const batchOverridePrefix = document.getElementById('batchOverridePrefix');
const batchOverrideCode = document.getElementById('batchOverrideCode');
const clearBatchOverrideBtn = document.getElementById('clearBatchOverrideBtn');

// Scheduler UI animation state
const schedulerQueueNodeByKey = new Map();
const schedulerQueuePrevIndexByKey = new Map();
let schedulerQueueHeadKey = null;
let schedulerTrackedTaskText = 'none';
const QUEUE_DIRECTION_HOLD_MS = 1400;

// Realtime control/log UI
const prepareBtn = document.getElementById('prepareBtn');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const startWithPamiCheckbox = document.getElementById('startWithPamiCheckbox');
const outputSelector = document.getElementById('outputSelector');
const statusDiv = document.getElementById('status');
const outputDiv = document.getElementById('output');

const frontStatusDot = document.getElementById('frontStatusDot');
const backStatusDot = document.getElementById('backStatusDot');
const pneumaticStatusDot = document.getElementById('pneumaticStatusDot');
const beaconStatusDot = document.getElementById('beaconStatusDot');
const frontStatusLabel = document.getElementById('frontStatusLabel');
const backStatusLabel = document.getElementById('backStatusLabel');
const pneumaticStatusLabel = document.getElementById('pneumaticStatusLabel');
const beaconStatusLabel = document.getElementById('beaconStatusLabel');

const STATUS_TIMEOUT_MS = 2000;
const STATUS_CHECK_INTERVAL_MS = 500;
const MAX_OUTPUT_LINES = 1000;
const START_WITH_PAMI_STORAGE_KEY = 'realtimeStartWithPamiEnabled';

let currentSource = localStorage.getItem('currentSource') || 'strategy';
let strategyEventSource = null;
let pathfindingEventSource = null;
let pamiEventSource = null;

const espStatusState = {
    front: { dot: frontStatusDot, label: frontStatusLabel, lastMessageAt: 0, connected: false, topic: null, mode: 'heartbeat' },
    back: { dot: backStatusDot, label: backStatusLabel, lastMessageAt: 0, connected: false, topic: null, mode: 'heartbeat' },
    pneumatic: { dot: pneumaticStatusDot, label: pneumaticStatusLabel, lastMessageAt: 0, connected: false, topic: null, mode: 'heartbeat' },
    beacon: { dot: beaconStatusDot, label: beaconStatusLabel, lastMessageAt: 0, connected: false, topic: null, mode: 'value' },
};

function loadOutput(key) {
    try {
        const data = JSON.parse(localStorage.getItem(key) || '[]');
        return data.slice(-MAX_OUTPUT_LINES);
    } catch (e) {
        console.error(`Failed to load ${key} from localStorage:`, e);
        localStorage.removeItem(key);
        return [];
    }
}

let strategyOutput = loadOutput('strategyOutput');
let pathfindingOutput = loadOutput('pathfindingOutput');
let pamiOutput = loadOutput('pamiOutput');

const savedStartWithPami = localStorage.getItem(START_WITH_PAMI_STORAGE_KEY);
if (startWithPamiCheckbox) {
    startWithPamiCheckbox.checked = savedStartWithPami === null ? true : savedStartWithPami === 'true';
    startWithPamiCheckbox.addEventListener('change', () => {
        localStorage.setItem(START_WITH_PAMI_STORAGE_KEY, String(startWithPamiCheckbox.checked));
    });
}

function displayCurrentOutput() {
    if (!outputDiv) return;
    const outputs = currentSource === 'strategy' ? strategyOutput : currentSource === 'pathfinding' ? pathfindingOutput : pamiOutput;
    outputDiv.innerHTML = '';
    outputs.forEach((text) => {
        const line = document.createElement('div');
        line.className = 'output-line';
        line.textContent = text;
        outputDiv.appendChild(line);
    });
    outputDiv.scrollTop = outputDiv.scrollHeight;
}

function isNearBottom(element, threshold = 24) {
    const distanceFromBottom = element.scrollHeight - (element.scrollTop + element.clientHeight);
    return distanceFromBottom <= threshold;
}

function appendOutputLine(lineText) {
    if (!outputDiv) return;
    const stickToBottom = isNearBottom(outputDiv);
    const line = document.createElement('div');
    line.className = 'output-line';
    line.textContent = lineText;
    outputDiv.appendChild(line);
    if (stickToBottom) {
        outputDiv.scrollTop = outputDiv.scrollHeight;
    }
}

function showStatus(message, type = 'info') {
    if (!statusDiv) return;
    const statusMsg = document.createElement('div');
    statusMsg.className = `status-message status-${type}`;
    statusMsg.textContent = message;
    statusDiv.appendChild(statusMsg);
    setTimeout(() => statusMsg.remove(), 5000);
}

function setEspConnectionState(key, isConnected, customLabel = null) {
    const entry = espStatusState[key];
    if (!entry) return;
    entry.connected = isConnected;
    entry.dot?.classList.toggle('connected', isConnected);
    entry.dot?.classList.toggle('disconnected', !isConnected);
    if (entry.label) {
        entry.label.textContent = customLabel ?? (isConnected ? 'Connected' : 'Disconnected');
    }
}

function markEspMessageReceived(key) {
    const entry = espStatusState[key];
    if (!entry) return;
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
    if (!ros || !entry) return null;

    const topic = new ROSLIB.Topic({ ros, name: topicName, messageType });
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

function subscribeFrontStatus() { return createStatusSubscription('front', '/front/status'); }
function subscribeBackStatus() { return createStatusSubscription('back', '/back/status'); }
function subscribePneumaticStatus() { return createStatusSubscription('pneumatic', '/pneumatic/status'); }
function subscribeBeaconStatus() { return createStatusSubscription('beacon', '/web/beacon_status', markBeaconMessageReceived, 'std_msgs/msg/Int32'); }

function disconnectAllEspTopics() {
    Object.entries(espStatusState).forEach(([key, entry]) => {
        if (entry.topic) {
            try { entry.topic.unsubscribe(); } catch (error) { console.warn('Failed to unsubscribe ESP status topic:', error); }
            entry.topic = null;
        }
        entry.lastMessageAt = 0;
        if (entry.mode === 'value' && key === 'beacon') {
            setBeaconReadyState(false);
        } else {
            setEspConnectionState(key, false);
        }
    });
}

function initializeEspStatusMonitoring() {
    if (typeof ROSLIB === 'undefined' || !ros) return;
    disconnectAllEspTopics();
    subscribeFrontStatus();
    subscribeBackStatus();
    subscribePneumaticStatus();
    subscribeBeaconStatus();
}

setInterval(() => {
    const now = Date.now();
    Object.entries(espStatusState).forEach(([key, entry]) => {
        if (entry.mode !== 'heartbeat') return;
        if (entry.lastMessageAt === 0) {
            setEspConnectionState(key, false);
            return;
        }
        const isFresh = (now - entry.lastMessageAt) <= STATUS_TIMEOUT_MS;
        setEspConnectionState(key, isFresh);
    });
}, STATUS_CHECK_INTERVAL_MS);

function startStreaming(source) {
    if (source === 'strategy') {
        if (strategyEventSource) strategyEventSource.close();
        strategyEventSource = new EventSource(`${API_URL}/stream/strategy`);
        strategyEventSource.onmessage = (event) => {
            strategyOutput.push(event.data);
            if (strategyOutput.length > MAX_OUTPUT_LINES) strategyOutput = strategyOutput.slice(-MAX_OUTPUT_LINES);
            try { localStorage.setItem('strategyOutput', JSON.stringify(strategyOutput)); } catch (_) { /* ignore */ }
            if (currentSource === 'strategy') appendOutputLine(event.data);
        };
    } else if (source === 'pathfinding') {
        if (pathfindingEventSource) pathfindingEventSource.close();
        pathfindingEventSource = new EventSource(`${API_URL}/stream/pathfinding`);
        pathfindingEventSource.onmessage = (event) => {
            pathfindingOutput.push(event.data);
            if (pathfindingOutput.length > MAX_OUTPUT_LINES) pathfindingOutput = pathfindingOutput.slice(-MAX_OUTPUT_LINES);
            try { localStorage.setItem('pathfindingOutput', JSON.stringify(pathfindingOutput)); } catch (_) { /* ignore */ }
            if (currentSource === 'pathfinding') appendOutputLine(event.data);
        };
    } else if (source === 'pami') {
        if (pamiEventSource) pamiEventSource.close();
        pamiEventSource = new EventSource(`${API_URL}/stream/pami`);
        pamiEventSource.onmessage = (event) => {
            pamiOutput.push(event.data);
            if (pamiOutput.length > MAX_OUTPUT_LINES) pamiOutput = pamiOutput.slice(-MAX_OUTPUT_LINES);
            try { localStorage.setItem('pamiOutput', JSON.stringify(pamiOutput)); } catch (_) { /* ignore */ }
            if (currentSource === 'pami') appendOutputLine(event.data);
        };
    }
}

function stopOtherStreams(selectedSource) {
    if (selectedSource !== 'strategy' && strategyEventSource) { strategyEventSource.close(); strategyEventSource = null; }
    if (selectedSource !== 'pathfinding' && pathfindingEventSource) { pathfindingEventSource.close(); pathfindingEventSource = null; }
    if (selectedSource !== 'pami' && pamiEventSource) { pamiEventSource.close(); pamiEventSource = null; }
}

function setupOutputStreaming() {
    if (outputSelector) {
        outputSelector.value = currentSource;
        outputSelector.addEventListener('change', () => {
            currentSource = outputSelector.value;
            localStorage.setItem('currentSource', currentSource);
            stopOtherStreams(currentSource);
            startStreaming(currentSource);
            displayCurrentOutput();
        });
    }

    startStreaming(currentSource);
    displayCurrentOutput();
}

async function prepareRobot() {
    if (prepareBtn) prepareBtn.disabled = true;
    showStatus('Preparing robot...', 'info');

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        const response = await fetch(`${API_URL}/prepare`, { method: 'POST', signal: controller.signal });
        clearTimeout(timeoutId);
        const data = await response.json();

        if (response.ok) {
            showStatus(data.message || 'Robot prepared successfully!', 'success');
            pathfindingOutput = [];
            localStorage.setItem('pathfindingOutput', JSON.stringify(pathfindingOutput));
            if (outputDiv) outputDiv.innerHTML = '';
            currentSource = 'pathfinding';
            localStorage.setItem('currentSource', currentSource);
            if (outputSelector) outputSelector.value = currentSource;
            stopOtherStreams(currentSource);
            startStreaming('pathfinding');
        } else {
            showStatus(data.error || 'Failed to prepare robot', 'error');
        }
    } catch (error) {
        showStatus(error.name === 'AbortError' ? 'Request timeout - too many open connections. Try refreshing the page.' : `Error: ${error.message}`, 'error');
    } finally {
        if (prepareBtn) prepareBtn.disabled = false;
    }
}

async function startStrategy() {
    if (startBtn) startBtn.disabled = true;
    const publishPami = Boolean(startWithPamiCheckbox && startWithPamiCheckbox.checked);
    showStatus(`Starting strategy${publishPami ? ' with PAMI' : ''}...`, 'info');

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        const response = await fetch(`${API_URL}/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ publish_pami: publishPami }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        const data = await response.json();

        if (response.ok) {
            showStatus(data.message || 'Strategy started successfully!', 'success');
            strategyOutput = [];
            localStorage.setItem('strategyOutput', JSON.stringify(strategyOutput));
            if (outputDiv) outputDiv.innerHTML = '';
            currentSource = 'strategy';
            localStorage.setItem('currentSource', currentSource);
            if (outputSelector) outputSelector.value = currentSource;
            stopOtherStreams(currentSource);
            startStreaming('strategy');
        } else {
            showStatus(data.error || 'Failed to start strategy', 'error');
        }
    } catch (error) {
        showStatus(error.name === 'AbortError' ? 'Request timeout - too many open connections. Try refreshing the page.' : `Error: ${error.message}`, 'error');
    } finally {
        if (startBtn) startBtn.disabled = false;
    }
}

async function stopStrategy() {
    if (stopBtn) stopBtn.disabled = true;
    showStatus('Stopping strategy...', 'info');

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        const response = await fetch(`${API_URL}/stop`, { method: 'POST', signal: controller.signal });
        clearTimeout(timeoutId);

        const data = await response.json();
        if (response.ok) {
            showStatus(data.message || 'Strategy stopped successfully!', 'success');
        } else {
            showStatus(data.error || 'Failed to stop strategy', 'error');
        }
    } catch (error) {
        showStatus(error.name === 'AbortError' ? 'Request timeout - too many open connections. Try refreshing the page.' : `Error: ${error.message}`, 'error');
    } finally {
        if (stopBtn) stopBtn.disabled = false;
    }
}

// Initialize ROS2 Bridge
initROS();
setupOutputStreaming();

// Initialize on page load
window.addEventListener('load', () => {
    // Wait for map to load before creating robot marker
    if (map.complete) {
        initializeRobotMarker();
    } else {
        map.addEventListener('load', () => {
            initializeRobotMarker();
        });
    }
});

function initROS() {
    console.log('🔌 Connecting to ROS2 Bridge at:', ROSBRIDGE_URL);
    
    ros = new ROSLIB.Ros({
        url: ROSBRIDGE_URL
    });

    ros.on('connection', function() {
        console.log('✅ Connected to ROS2 Bridge');
        isConnected = true;
        updateConnectionStatus(true);
        
        // Subscribe to robot pose
        subscribeToRobotPose();
        
        // Subscribe to obstacles
        subscribeToObstacles();
        
        // Subscribe to enemy robot
        subscribeToEnemyRobot();
        subscribeToEnemyRobotSpeed();
        
        // Subscribe to path visualization
        subscribeToPathVisualization();

        // Subscribe to task scheduler status
        subscribeToTaskSchedulerStatus();

        // Subscribe to ESP status heartbeat/value topics
        initializeEspStatusMonitoring();

        // Subscribe to TEST controller results (used to detect clear_map)
        subscribeToTestControllerResult();
    });

    ros.on('error', function(error) {
        console.error('❌ ROS2 Bridge error:', error);
        isConnected = false;
        updateConnectionStatus(false);
    });

    ros.on('close', function() {
        console.log('�� Disconnected from ROS2 Bridge');
        isConnected = false;
        updateConnectionStatus(false);
        
        // Try to reconnect after 3 seconds
        setTimeout(() => {
            console.log('🔄 Attempting to reconnect...');
            initROS();
        }, 3000);
    });
}

function updateConnectionStatus(connected) {
    if (connected) {
        rosStatus.classList.add('connected');
        statusText.textContent = 'Connected';
    } else {
        rosStatus.classList.remove('connected');
        statusText.textContent = 'Disconnected';
    }
}

function subscribeToRobotPose() {
    console.log('📡 Subscribing to /robot_pose_raw');
    
    const listener = new ROSLIB.Topic({
        ros: ros,
        name: '/robot_pose_raw',
        messageType: 'geometry_msgs/Vector3'
    });
    
    listener.subscribe(function(message) {
        // Update robot pose from Vector3 (x, y, z where z is orientation)
        robotPose.x = message.x;
        robotPose.y = message.y;
        robotPose.theta = message.z;
        
        // Update display
        updateRobotDisplay();
        
        // Update robot marker on map
        updateRobotMarker();
        
        // Update last update time
        lastUpdateTime = new Date();
        updateLastUpdateDisplay();
    });
}

function subscribeToEnemyRobot() {
    const listener = new ROSLIB.Topic({
        ros: ros,
        name: '/obstacle_relative',
        messageType: 'geometry_msgs/PoseStamped'
    });
    
    listener.subscribe(function(message) {
        // Throttle updates to prevent browser lag from high-frequency lidar data
        const now = Date.now();
        if (now - lastEnemyUpdateTime < ENEMY_UPDATE_THROTTLE_MS) {
            return;  // Skip this update
        }
        lastEnemyUpdateTime = now;
        
        // Check if the message frame_id indicates base_link or map frame
        const frameId = message.header.frame_id;
        const posX = message.pose.position.x;
        const posY = message.pose.position.y;
        
        let globalX, globalY;
        
        if (frameId === 'base_link' || frameId === 'base_footprint') {
            // Transform from robot frame to global coordinates
            const cosTheta = Math.cos(robotPose.theta);
            const sinTheta = Math.sin(robotPose.theta);
            
            globalX = robotPose.x + (posX * cosTheta - posY * sinTheta);
            globalY = robotPose.y + (posX * sinTheta + posY * cosTheta);
        } else {
            // Already in global/map frame
            globalX = posX;
            globalY = posY;
        }
        
        enemyRobot = {
            x: globalX,  // in meters
            y: globalY,  // in meters
            theta: 0  // We don't have orientation info from the message
        };
        
        // Update enemy robot marker
        updateEnemyRobotMarker();
    });
}

function subscribeToEnemyRobotSpeed() {
    const speedListener = new ROSLIB.Topic({
        ros: ros,
        name: '/obstacle_relative_speed',
        messageType: 'geometry_msgs/Twist'
    });

    speedListener.subscribe(function(message) {
        enemyRobotSpeed.vx = Number(message?.linear?.x) || 0;
        enemyRobotSpeed.vy = Number(message?.linear?.y) || 0;
        enemyRobotSpeed.updatedAt = Date.now();

        if (enemyRobot) {
            updateEnemyRobotMarker();
        }
    });
}

function subscribeToObstacles() {
    // Subscribe to obstacles topic from pathfinding_node
    // The pathfinding_node publishes ObstacleArray to /obstacles/current
    const obstacleListener = new ROSLIB.Topic({
        ros: ros,
        name: '/obstacles/current',
        messageType: 'hybrid_astar/ObstacleArray'
    });
    
    obstacleListener.subscribe(function(message) {
        try {
            // Clear all existing obstacles
            obstacles = [];
            
            // Process obstacles from ObstacleArray message
            if (message.obstacles) {
                message.obstacles.forEach(obs => {
                    // Check if the obstacle has valid data
                    if (obs.pose && typeof obs.pose.x !== 'undefined' && typeof obs.pose.y !== 'undefined') {
                        // Only add yellow or blue obstacles (not walls or generic obstacles)
                        if (obs.color === 'yellow' || obs.color === 'blue') {
                            obstacles.push({
                                aruco_id: obs.id || '',
                                x: obs.pose.x, // Already in mm
                                y: obs.pose.y, // Already in mm
                                theta: typeof obs.pose.theta !== 'undefined' ? obs.pose.theta : 0,
                                color: obs.color,
                                batch_id: 0,
                                width_mm: obs.width_mm || 50,
                                height_mm: obs.height_mm || 50,
                                direction: obs.width_mm > obs.height_mm ? 'horizontal' : 'vertical'
                            });
                        }
                    }
                });
            }
            
            drawObstacles();
            updateObstacleCount();
        } catch (error) {
            console.error('Error parsing obstacle data from ROS:', error);
        }
    });
}

function subscribeToPathVisualization() {
    console.log('📡 Subscribing to /path_visualization (hybrid A* path)');
    
    const listener = new ROSLIB.Topic({
        ros: ros,
        name: '/path_visualization',
        messageType: 'visualization_msgs/MarkerArray'
    });
    
    listener.subscribe(function(message) {
        const markers = Array.isArray(message.markers) ? message.markers : [];

        // Only process path markers (LINE_STRIP = 4).
        // Ignore DELETEALL-only obstacle refreshes coming from map visualization updates.
        const pathMarker = markers.find(m => m && m.type === 4 && Array.isArray(m.points));
        if (!pathMarker || pathMarker.points.length === 0) {
            return;
        }

        // Convert points to dashboard coordinate source format (meters)
        currentPath = pathMarker.points.map(point => ({
            x: point.x,
            y: point.y
        }));

        // Keep all paths for this game
        pathHistory.push(currentPath);

        console.log(`✅ Received path #${pathHistory.length} with ${currentPath.length} waypoints`);

        // Draw all paths
        drawPath();
    });
}

function subscribeToTaskSchedulerStatus() {
    console.log('📡 Subscribing to /web/task_scheduler_status');

    const listener = new ROSLIB.Topic({
        ros: ros,
        name: '/web/task_scheduler_status',
        messageType: 'std_msgs/String'
    });

    listener.subscribe(function(message) {
        try {
            const data = JSON.parse(message.data || '{}');
            renderTaskSchedulerStatus(data);
        } catch (error) {
            console.error('Failed to parse /web/task_scheduler_status:', error);
        }
    });
}

function subscribeToTestControllerResult() {
    console.log('📡 Subscribing to /web/test_controller_result');

    const listener = new ROSLIB.Topic({
        ros: ros,
        name: '/web/test_controller_result',
        messageType: 'std_msgs/String'
    });

    listener.subscribe(function(message) {
        try {
            const data = JSON.parse(message.data || '{}');
            const isClearMapSuccess = Boolean(
                data &&
                data.success === true &&
                String(data.controller || '').toLowerCase() === 'hybrid_astar' &&
                String(data.action || '').toLowerCase() === 'clear_map'
            );

            if (!isClearMapSuccess) {
                return;
            }

            currentPath = [];
            pathHistory = [];
            drawPath();
            console.log('🧹 clear_map success received, cleared path history for new game');
        } catch (error) {
            console.error('Failed to parse /web/test_controller_result:', error);
        }
    });
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function callHybridAstarTestAction(action, payload = {}, timeoutMs = 7000) {
    return new Promise((resolve, reject) => {
        if (!isConnected || !ros) {
            reject(new Error('Not connected to ROS2'));
            return;
        }

        const requestId = `realtime-${action}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
        const commandTopic = new ROSLIB.Topic({
            ros: ros,
            name: '/web/test_controller',
            messageType: 'std_msgs/String'
        });

        const resultTopic = new ROSLIB.Topic({
            ros: ros,
            name: '/web/test_controller_result',
            messageType: 'std_msgs/String'
        });

        let handled = false;
        const timeoutHandle = setTimeout(() => {
            if (handled) return;
            handled = true;
            resultTopic.unsubscribe();
            reject(new Error(`${action} timeout`));
        }, timeoutMs);

        resultTopic.subscribe((message) => {
            if (handled) return;

            try {
                const result = JSON.parse(message.data || '{}');
                if (!result || result.request_id !== requestId) {
                    return;
                }

                handled = true;
                clearTimeout(timeoutHandle);
                resultTopic.unsubscribe();

                if (result.success) {
                    resolve(result);
                } else {
                    reject(new Error(result.message || `${action} failed`));
                }
            } catch (error) {
                handled = true;
                clearTimeout(timeoutHandle);
                resultTopic.unsubscribe();
                reject(new Error(`Invalid ${action} response: ${error.message}`));
            }
        });

        const msg = new ROSLIB.Message({
            data: JSON.stringify({
                controller: 'hybrid_astar',
                action,
                request_id: requestId,
                ...(payload || {})
            })
        });

        commandTopic.publish(msg);
    });
}

async function restartBeacon() {
    if (!isConnected || !ros) {
        showStatus('Not connected to ROS2. Please check the connection.', 'error');
        return;
    }

    if (restartBeaconBtn) {
        restartBeaconBtn.disabled = true;
        restartBeaconBtn.textContent = '⏳ Restarting...';
    }

    try {
        console.log('🔁 Restart beacon flow: reset_beacon -> clear_map -> wait 1s -> update_map');
        showStatus('Restarting beacon...', 'info');
        await callHybridAstarTestAction('reset_beacon');
        await callHybridAstarTestAction('clear_map');
        await delay(1000);
        await callHybridAstarTestAction('update_map');
        showStatus('Beacon restarted successfully.', 'success');
    } catch (error) {
        console.error('❌ Restart beacon failed:', error);
        showStatus(`Restart beacon failed: ${error.message}`, 'error');
    } finally {
        if (restartBeaconBtn) {
            restartBeaconBtn.disabled = false;
            restartBeaconBtn.textContent = '🔁 Restart Beacon';
        }
    }
}

function getOverrideCodeInput() {
    const rawCode = String(batchOverrideCode?.value || '').trim();
    if (!rawCode) {
        throw new Error('Please enter a compact code like 14');
    }
    return rawCode;
}

function parseCompactBatchCode(rawCode) {
    const compact = String(rawCode || '').replace(/\s+/g, '');
    if (!/^\d{2}$/.test(compact)) {
        throw new Error(`Invalid code '${rawCode}'. Expected 2 digits like 14.`);
    }

    const index = parseInt(compact[0], 10);
    const patternCode = compact[1];
    if (!Number.isFinite(index) || index <= 0) {
        throw new Error(`Invalid batch index in code '${rawCode}'`);
    }

    const patternByCode = {
        '1': 'yybb',
        '2': 'ybyb',
        '3': 'ybby',
        '4': 'byyb',
        '5': 'byby',
        '6': 'bbyy'
    };

    const pattern = patternByCode[patternCode];
    if (!pattern) {
        throw new Error(`Invalid pattern code '${patternCode}' in '${rawCode}' (allowed 1..6)`);
    }

    return { index, pattern, compact };
}

function getKnownBatchCenterMm(prefix, index) {
    const sxCenters = {
        s1: { x: 800, y: 175 },
        s2: { x: 1600, y: 175 },
        s3: { x: 1200, y: 1150 },
        s4: { x: 1825, y: 1100 },
        s5: { x: 1200, y: 1850 },
        s6: { x: 1825, y: 1900 },
        s7: { x: 800, y: 2800 },
        s8: { x: 1600, y: 2800 }
    };

    const fxCenters = {
        f1: { x: 1200, y: 100 },
        f2: { x: 1900, y: 700 },
        f3: { x: 1200, y: 800 },
        f5: { x: 1200, y: 1500 },
        f6: { x: 1900, y: 1500 },
        f8: { x: 1200, y: 2200 },
        f9: { x: 1900, y: 2300 },
        f10: { x: 1200, y: 2900 }
    };

    const knownId = `${prefix}${index}`;
    const table = prefix === 's' ? sxCenters : fxCenters;
    const center = table[knownId];
    if (!center) {
        throw new Error(`No predefined center for ${knownId}`);
    }
    return { knownId, center };
}

function getBatchDirectionForKnownId(knownId) {
    if (knownId.startsWith('s')) {
        return (knownId === 's1' || knownId === 's2') ? 'horizontal' : 'vertical';
    }
    return 'vertical';
}

function buildMembersFromPattern(centerMm, direction, pattern, arucoBaseId = 9000) {
    const offsets = direction === 'horizontal'
        ? [{ x: -75, y: 0 }, { x: -25, y: 0 }, { x: 25, y: 0 }, { x: 75, y: 0 }]
        : [{ x: 0, y: -75 }, { x: 0, y: -25 }, { x: 0, y: 25 }, { x: 0, y: 75 }];

    const chars = pattern.split('');
    return offsets.map((offset, i) => ({
        aruco_id: arucoBaseId + i,
        position: {
            x: centerMm.x + offset.x,
            y: centerMm.y + offset.y
        },
        color: chars[i] === 'y' ? 'yellow' : 'blue'
    }));
}

function publishBatchesLikePathfinding(batchesTable) {
    return new Promise((resolve, reject) => {
        if (!isConnected || !ros) {
            reject(new Error('Not connected to ROS2'));
            return;
        }

        try {
            const topic = new ROSLIB.Topic({
                ros,
                name: '/web/send_batches',
                messageType: 'std_msgs/String'
            });

            topic.publish(new ROSLIB.Message({
                data: JSON.stringify({ batches: batchesTable })
            }));

            const updateMapService = new ROSLIB.Service({
                ros,
                name: '/update_map',
                serviceType: 'std_srvs/Trigger'
            });

            updateMapService.callService(new ROSLIB.ServiceRequest({}), (result) => {
                if (result && result.success) {
                    resolve(result.message || 'update_map succeeded');
                } else {
                    reject(new Error((result && result.message) || 'update_map failed'));
                }
            }, (error) => {
                reject(new Error(`Failed to call /update_map: ${error}`));
            });
        } catch (error) {
            reject(error);
        }
    });
}

async function applyBatchPatternOverride() {
    try {
        const code = getOverrideCodeInput();
        const prefix = String(batchOverridePrefix?.value || 's').trim().toLowerCase();
        if (prefix !== 's') {
            throw new Error(`Invalid prefix '${prefix}'`);
        }

        await callHybridAstarTestAction('set_batch_pattern_override', { code, prefix });
    } catch (error) {
        console.error('❌ Failed to apply batch override:', error);
        alert(`Failed to apply override: ${error.message}`);
    }
}

async function clearBatchPatternOverride() {
    try {
        const code = getOverrideCodeInput();
        const prefix = 's';
        const res = await callHybridAstarTestAction('clear_batch_pattern_override', { code, prefix });
        alert(res.message || 'Pattern override cleared');
    } catch (error) {
        console.error('❌ Failed to clear batch override:', error);
        alert(`Failed to clear override: ${error.message}`);
    }
}

function renderTaskSchedulerStatus(status) {
    if (!status || typeof status !== 'object') return;

    if (schedulerSourceDisplay) {
        schedulerSourceDisplay.textContent = status.source || '-';
    }

    if (schedulerRemainingDisplay) {
        if (typeof status.time_left_s === 'number' && isFinite(status.time_left_s)) {
            schedulerRemainingDisplay.textContent = status.time_left_s.toFixed(1);
        } else {
            schedulerRemainingDisplay.textContent = '-';
        }
    }

    if (schedulerFrontEmptyDisplay) {
        schedulerFrontEmptyDisplay.textContent = status.front_empty ? 'empty' : 'holding';
    }

    if (schedulerBackEmptyDisplay) {
        schedulerBackEmptyDisplay.textContent = status.back_empty ? 'empty' : 'holding';
    }

    if (schedulerTrackedTaskDisplay) {
        const tracked = status.tracked_task;
        let nextTrackedText = 'none';
        if (tracked && tracked.target_id) {
            const scoreText = typeof tracked.score === 'number' ? ` (${tracked.score.toFixed(2)})` : '';
            nextTrackedText = `${tracked.type || 'task'}:${tracked.target_id}${scoreText}`;
        }

        if (schedulerTrackedTaskText !== nextTrackedText) {
            schedulerTrackedTaskDisplay.classList.remove('value-flash');
            void schedulerTrackedTaskDisplay.offsetWidth;
            schedulerTrackedTaskDisplay.classList.add('value-flash');
            schedulerTrackedTaskText = nextTrackedText;
        }

        schedulerTrackedTaskDisplay.textContent = nextTrackedText;
    }

    if (schedulerQueueSizeDisplay) {
        const queueSize = typeof status.queue_size === 'number' ? status.queue_size : 0;
        schedulerQueueSizeDisplay.textContent = String(queueSize);
    }

    if (schedulerQueueList) {
        const queue = Array.isArray(status.queue) ? status.queue : [];
        renderSchedulerQueue(queue);
    }
}

function getSchedulerQueueItemKey(item) {
    if (!item || typeof item !== 'object') return 'task:?';
    const type = item.type || 'task';
    const target = item.target_id || '?';
    const options = item.options && typeof item.options === 'object'
        ? JSON.stringify(item.options)
        : '';
    return `${type}:${target}:${options}`;
}

function getSchedulerQueueItemText(item, idx) {
    const scoreText = typeof item.score === 'number' ? item.score.toFixed(2) : '-';
    const options = item.options && typeof item.options === 'object'
        ? Object.entries(item.options).map(([k, v]) => `${k}=${v}`).join(', ')
        : '';
    return `${idx + 1}. ${item.type || 'task'}:${item.target_id || '?'} | score=${scoreText}${options ? ` | ${options}` : ''}`;
}

function renderSchedulerQueue(queue) {
    if (!schedulerQueueList) return;

    const counts = new Map();
    const nextKeys = [];
    const nextKeySet = new Set();

    queue.forEach((item, idx) => {
        const baseKey = getSchedulerQueueItemKey(item);
        const occurrence = (counts.get(baseKey) || 0) + 1;
        counts.set(baseKey, occurrence);
        const key = `${baseKey}#${occurrence}`;
        nextKeys.push(key);
        nextKeySet.add(key);

        const text = getSchedulerQueueItemText(item, idx);
        let node = schedulerQueueNodeByKey.get(key);

        if (!node) {
            node = document.createElement('li');
            node.className = 'queue-item queue-item-enter';
            node.dataset.key = key;
            node.textContent = text;
            node.dataset.text = text;
            schedulerQueueNodeByKey.set(key, node);
            requestAnimationFrame(() => {
                node.classList.remove('queue-item-enter');
            });
        } else if (node.dataset.text !== text) {
            node.textContent = text;
            node.dataset.text = text;

            // Delay blue "content updated" cue so movement (red/green) remains readable first
            if (node._queueUpdateDelayTimer) {
                clearTimeout(node._queueUpdateDelayTimer);
                node._queueUpdateDelayTimer = null;
            }
            if (node._queueUpdateClearTimer) {
                clearTimeout(node._queueUpdateClearTimer);
                node._queueUpdateClearTimer = null;
            }

            node.classList.remove('queue-item-updated');
            const now = Date.now();
            const movementRemainingMs = node._queueMoveUntil && node._queueMoveUntil > now
                ? (node._queueMoveUntil - now)
                : 0;
            const delayedUpdateMs = Math.max(700, movementRemainingMs + 120);

            node._queueUpdateDelayTimer = setTimeout(() => {
                node.classList.remove('queue-item-updated');
                void node.offsetWidth;
                node.classList.add('queue-item-updated');

                node._queueUpdateClearTimer = setTimeout(() => {
                    node.classList.remove('queue-item-updated');
                    node._queueUpdateClearTimer = null;
                }, 950);

                node._queueUpdateDelayTimer = null;
            }, delayedUpdateMs);
        }
    });

    for (const [key, node] of schedulerQueueNodeByKey.entries()) {
        if (!nextKeySet.has(key)) {
            if (node._queueMoveTimer) {
                clearTimeout(node._queueMoveTimer);
                node._queueMoveTimer = null;
            }
            if (node._queueUpdateDelayTimer) {
                clearTimeout(node._queueUpdateDelayTimer);
                node._queueUpdateDelayTimer = null;
            }
            if (node._queueUpdateClearTimer) {
                clearTimeout(node._queueUpdateClearTimer);
                node._queueUpdateClearTimer = null;
            }
            node.classList.add('queue-item-exit');
            schedulerQueueNodeByKey.delete(key);
            setTimeout(() => {
                if (node.parentNode) node.remove();
            }, 220);
        }
    }

    if (nextKeys.length === 0) {
        const existing = schedulerQueueList.querySelector('.queue-empty');
        if (!existing) {
            const empty = document.createElement('li');
            empty.className = 'queue-empty';
            empty.textContent = 'Queue is empty';
            schedulerQueueList.innerHTML = '';
            schedulerQueueList.appendChild(empty);
        }
        schedulerQueueHeadKey = null;
        schedulerQueuePrevIndexByKey.clear();
        return;
    }

    const emptyNode = schedulerQueueList.querySelector('.queue-empty');
    if (emptyNode) emptyNode.remove();

    nextKeys.forEach((key, idx) => {
        const node = schedulerQueueNodeByKey.get(key);
        if (!node) return;

        const prevIdx = schedulerQueuePrevIndexByKey.get(key);
        if (typeof prevIdx === 'number' && prevIdx !== idx) {
            if (idx < prevIdx) {
                applyQueueMoveClass(node, 'queue-item-move-up');
            } else {
                applyQueueMoveClass(node, 'queue-item-move-down');
            }
        }

        node.classList.toggle('queue-item-head', idx === 0);
        if (idx === 0 && schedulerQueueHeadKey !== key) {
            node.classList.remove('queue-item-head-flash');
            void node.offsetWidth;
            node.classList.add('queue-item-head-flash');
        }

        schedulerQueueList.appendChild(node);
    });

    schedulerQueueHeadKey = nextKeys[0];
    schedulerQueuePrevIndexByKey.clear();
    nextKeys.forEach((key, idx) => {
        schedulerQueuePrevIndexByKey.set(key, idx);
    });
}

function applyQueueMoveClass(node, moveClass) {
    const oppositeClass = moveClass === 'queue-item-move-up'
        ? 'queue-item-move-down'
        : 'queue-item-move-up';

    const alreadySameDirection = node.classList.contains(moveClass) && !node.classList.contains(oppositeClass);

    if (!alreadySameDirection) {
        node.classList.remove(oppositeClass);
        node.classList.remove(moveClass);
        void node.offsetWidth;
        node.classList.add(moveClass);
    }

    if (node._queueMoveTimer) {
        clearTimeout(node._queueMoveTimer);
        node._queueMoveTimer = null;
    }

    node._queueMoveTimer = setTimeout(() => {
        node.classList.remove('queue-item-move-up', 'queue-item-move-down');
        node._queueMoveUntil = null;
        node._queueMoveTimer = null;
    }, QUEUE_DIRECTION_HOLD_MS);

    node._queueMoveUntil = Date.now() + QUEUE_DIRECTION_HOLD_MS;
}

function initializeRobotMarker() {
    if (robotMarker) {
        robotMarker.remove();
    }
    
    // Create robot marker
    robotMarker = document.createElement('div');
    robotMarker.className = 'robot-marker';
    robotMarker.style.display = 'none'; // Hide until we receive first pose
    
    mapWrapper.appendChild(robotMarker);
    
    // Create enemy robot marker
    if (enemyRobotMarker) {
        enemyRobotMarker.remove();
    }
    
    enemyRobotMarker = document.createElement('div');
    enemyRobotMarker.className = 'enemy-robot-marker';
    enemyRobotMarker.style.display = 'none'; // Hide until we detect enemy

    enemySpeedArrow = document.createElement('div');
    enemySpeedArrow.className = 'enemy-speed-arrow';
    enemySpeedArrow.style.display = 'none';
    enemyRobotMarker.appendChild(enemySpeedArrow);
    
    mapWrapper.appendChild(enemyRobotMarker);
    
    console.log('✅ Robot markers initialized');
}

function updateRobotDisplay() {
    // Update info overlay
    if (robotXDisplay) {
        robotXDisplay.textContent = robotPose.x.toFixed(3);
    }
    if (robotYDisplay) {
        robotYDisplay.textContent = robotPose.y.toFixed(3);
    }
    
    // Convert radians to degrees for display
    const thetaDeg = (robotPose.theta * 180 / Math.PI).toFixed(1);
    if (robotThetaDisplay) {
        robotThetaDisplay.textContent = thetaDeg;
    }
}

function updateRobotMarker() {
    if (!robotMarker) return;
    
    const displayWidth = map.offsetWidth;
    const displayHeight = map.offsetHeight;
    
    // Convert robot position from meters to mm
    const x_mm = robotPose.x * 1000;
    const y_mm = robotPose.y * 1000;
    
    // Convert to pixel coordinates (with x/y swap for map coordinate system)
    // Scale from mm to actual displayed pixels
    const x_px = (y_mm / MAP_WIDTH_MM) * displayWidth;
    const y_px = (x_mm / MAP_HEIGHT_MM) * displayHeight;
    
    // Calculate robot size in pixels (scaled)
    const robotSize_px = (ROBOT_SIZE_MM / MAP_WIDTH_MM) * displayWidth;
    
    // Position robot marker
    robotMarker.style.left = x_px + 'px';
    robotMarker.style.top = y_px + 'px';
    robotMarker.style.width = robotSize_px + 'px';
    robotMarker.style.height = robotSize_px + 'px';
    robotMarker.style.transform =`translate(-50%, -50%) rotate(${-robotPose.theta + Math.PI / 2}rad)`;
    robotMarker.style.display = 'flex';
    
    // Add trail effect
    if (trailEnabled) {
        addTrailPoint(x_px, y_px);
    }
}

function updateEnemyRobotMarker() {
    if (!enemyRobotMarker || !enemyRobot) return;
    
    const displayWidth = map.offsetWidth;
    const displayHeight = map.offsetHeight;
    
    // Convert enemy robot position from meters to mm
    const x_mm = enemyRobot.x * 1000;
    const y_mm = enemyRobot.y * 1000;
    
    // Convert to pixel coordinates (with x/y swap for map coordinate system)
    const x_px = (y_mm / MAP_WIDTH_MM) * displayWidth;
    const y_px = (x_mm / MAP_HEIGHT_MM) * displayHeight;
    
    // Use enemy robot dimensions: 350mm x 350mm
    const enemyWidth_mm = 350;
    const enemyHeight_mm = 350;
    
    // Calculate enemy robot size in pixels (scaled)
    const robotWidth_px = (enemyWidth_mm / MAP_WIDTH_MM) * displayWidth;
    const robotHeight_px = (enemyHeight_mm / MAP_HEIGHT_MM) * displayHeight;
    
    // Position enemy robot marker
    enemyRobotMarker.style.left = x_px + 'px';
    enemyRobotMarker.style.top = y_px + 'px';
    enemyRobotMarker.style.width = robotWidth_px + 'px';
    enemyRobotMarker.style.height = robotHeight_px + 'px';
    enemyRobotMarker.style.transform = 'translate(-50%, -50%)';
    enemyRobotMarker.style.display = 'flex';

    if (!enemySpeedArrow) return;

    const speedAgeMs = Date.now() - enemyRobotSpeed.updatedAt;
    const speedMps = Math.hypot(enemyRobotSpeed.vx, enemyRobotSpeed.vy);
    const hasFreshSpeed = speedAgeMs <= ENEMY_SPEED_STALE_MS;

    if (!hasFreshSpeed || speedMps < ENEMY_SPEED_MIN_MPS) {
        enemySpeedArrow.style.display = 'none';
        return;
    }

    // Convert map-frame velocity (m/s) to screen velocity (px/s).
    const vxScreenPxPerSec = (enemyRobotSpeed.vy * 1000 / MAP_WIDTH_MM) * displayWidth;
    const vyScreenPxPerSec = (enemyRobotSpeed.vx * 1000 / MAP_HEIGHT_MM) * displayHeight;
    const speedScreenPxPerSec = Math.hypot(vxScreenPxPerSec, vyScreenPxPerSec);

    // Arrow length represents speed as projected displacement over 180ms.
    const arrowLengthPx = Math.max(16, Math.min(120, speedScreenPxPerSec * 0.18));
    const arrowAngle = Math.atan2(vyScreenPxPerSec, vxScreenPxPerSec);

    enemySpeedArrow.style.width = `${arrowLengthPx.toFixed(1)}px`;
    enemySpeedArrow.style.transform = `translate(-50%, -50%) rotate(${arrowAngle}rad)`;
    enemySpeedArrow.style.display = 'block';
}

function addTrailPoint(x, y) {
    const trail = document.createElement('div');
    trail.className = 'robot-trail';
    trail.style.left = x + 'px';
    trail.style.top = y + 'px';
    trail.style.transform = 'translate(-50%, -50%)';
    
    mapWrapper.appendChild(trail);
    
    // Remove trail point after animation
    setTimeout(() => {
        trail.remove();
    }, 2000);
    
    // Limit number of trail points
    const trails = mapWrapper.querySelectorAll('.robot-trail');
    if (trails.length > maxTrailPoints) {
        trails[0].remove();
    }
}

function drawObstacles() {
    // Remove existing obstacle markers
    const existingObstacles = mapWrapper.querySelectorAll('.obstacle-marker');
    existingObstacles.forEach(marker => marker.remove());
    
    if (obstacles.length === 0) {
        return;
    }
    
    // Wait for map to be loaded and have dimensions
    if (!map.complete || map.offsetWidth === 0 || map.offsetHeight === 0) {
        setTimeout(drawObstacles, 100);
        return;
    }
    
    const displayWidth = map.offsetWidth;
    const displayHeight = map.offsetHeight;
    
    obstacles.forEach((obstacle, index) => {
        // Obstacle positions are already in mm (not meters!)
        const x_mm = obstacle.x;
        const y_mm = obstacle.y;
        
        // Convert to pixel coordinates (with x/y swap)
        // Scale from mm to actual displayed pixels
        // Position relative to the map image (which is at 0,0 within map-wrapper)
        const pos_x_px = (y_mm / MAP_WIDTH_MM) * displayWidth;
        const pos_y_px = (x_mm / MAP_HEIGHT_MM) * displayHeight;
        
        // Use actual width and height from ROS message.
        // With theta-based rotation enabled, dimensions should match ROS directly.
        const width_mm = obstacle.width_mm || 50;
        const height_mm = obstacle.height_mm || 50;
        
        // Calculate dimensions in pixels (scaled)
        const width_px = (width_mm / MAP_WIDTH_MM) * displayWidth;
        const height_px = (height_mm / MAP_HEIGHT_MM) * displayHeight;
        
        // Obstacle coordinates are center-based, so anchor marker from center
        const center_x_px = pos_x_px;
        const center_y_px = pos_y_px;

        // Convert map-frame yaw to dashboard screen rotation.
        // The realtime view swaps map x/y axes, so screen angle = π/2 - theta.
        const theta = typeof obstacle.theta === 'number' ? obstacle.theta : 0;
        const screenTheta = -theta + Math.PI / 2;
        
        // Create obstacle marker
        const obstacleMarker = document.createElement('div');
        obstacleMarker.className = 'obstacle-marker ' + obstacle.color;
        obstacleMarker.style.position = 'absolute';
        obstacleMarker.style.left = center_x_px + 'px';
        obstacleMarker.style.top = center_y_px + 'px';
        obstacleMarker.style.width = width_px + 'px';
        obstacleMarker.style.height = height_px + 'px';
        obstacleMarker.style.transform = `translate(-50%, -50%) rotate(${screenTheta}rad)`;
        obstacleMarker.style.zIndex = '50';
        obstacleMarker.style.pointerEvents = 'none';
        obstacleMarker.title = `Color: ${obstacle.color}\nPosition: (${obstacle.x.toFixed(1)}mm, ${obstacle.y.toFixed(1)}mm)\nTheta: ${(theta * 180 / Math.PI).toFixed(1)}°`;
        
        mapWrapper.appendChild(obstacleMarker);
    });
}

function drawPath() {
    // Remove existing path visualization
    const existingPath = mapWrapper.querySelector('.path-visualization');
    if (existingPath) {
        existingPath.remove();
    }
    
    if (pathHistory.length === 0) {
        return;
    }
    
    // Wait for map to be loaded and have dimensions
    if (!map.complete || map.offsetWidth === 0 || map.offsetHeight === 0) {
        setTimeout(drawPath, 100);
        return;
    }
    
    const displayWidth = map.offsetWidth;
    const displayHeight = map.offsetHeight;
    
    // Create SVG for path
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'path-visualization');
    svg.style.position = 'absolute';
    svg.style.top = '0';
    svg.style.left = '0';
    svg.style.width = displayWidth + 'px';
    svg.style.height = displayHeight + 'px';
    svg.style.pointerEvents = 'none';
    svg.style.zIndex = '60';
    
    // Create one SVG path per computed trajectory in this game
    pathHistory.forEach((path, pathIndex) => {
        if (!Array.isArray(path) || path.length === 0) return;

        const pathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        let pathData = '';

        path.forEach((point, index) => {
            // Convert from meters to mm
            const x_mm = point.x * 1000;
            const y_mm = point.y * 1000;

            // Convert to pixel coordinates (with x/y swap for map coordinate system)
            const x_px = (y_mm / MAP_WIDTH_MM) * displayWidth;
            const y_px = (x_mm / MAP_HEIGHT_MM) * displayHeight;

            if (index === 0) {
                pathData += `M ${x_px} ${y_px}`;
            } else {
                pathData += ` L ${x_px} ${y_px}`;
            }
        });

        pathElement.setAttribute('d', pathData);
        pathElement.setAttribute('stroke', PATH_COLORS[pathIndex % PATH_COLORS.length]);
        pathElement.setAttribute('stroke-width', pathIndex === pathHistory.length - 1 ? '3.5' : '2.5');
        pathElement.setAttribute('fill', 'none');
        pathElement.setAttribute('stroke-linecap', 'round');
        pathElement.setAttribute('stroke-linejoin', 'round');
        pathElement.setAttribute('opacity', pathIndex === pathHistory.length - 1 ? '0.95' : '0.75');

        svg.appendChild(pathElement);
    });

    mapWrapper.appendChild(svg);
    
    console.log(`✅ Drew ${pathHistory.length} path(s)`);
}

function updateObstacleCount() {
    if (obstacleCountDisplay) {
        obstacleCountDisplay.textContent = obstacles.length;
    }
}

function updateLastUpdateDisplay() {
    if (!lastUpdateTime || !lastUpdateDisplay) return;
    
    const now = new Date();
    const diff = Math.floor((now - lastUpdateTime) / 1000);
    
    if (diff < 1) {
        lastUpdateDisplay.textContent = 'Just now';
    } else if (diff < 60) {
        lastUpdateDisplay.textContent = `${diff}s ago`;
    } else {
        const minutes = Math.floor(diff / 60);
        lastUpdateDisplay.textContent = `${minutes}m ago`;
    }
}

// Update last update display every second, but only when page is visible
let updateDisplayInterval = null;

function startUpdateDisplayInterval() {
    if (!updateDisplayInterval) {
        updateDisplayInterval = setInterval(updateLastUpdateDisplay, 1000);
    }
}

function stopUpdateDisplayInterval() {
    if (updateDisplayInterval) {
        clearInterval(updateDisplayInterval);
        updateDisplayInterval = null;
    }
}

// Start interval
startUpdateDisplayInterval();

if (restartBeaconBtn) {
    restartBeaconBtn.addEventListener('click', restartBeacon);
}

if (batchOverrideCode) {
    batchOverrideCode.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            applyBatchPatternOverride();
        }
    });
}

if (clearBatchOverrideBtn) {
    clearBatchOverrideBtn.addEventListener('click', clearBatchPatternOverride);
}

if (prepareBtn) {
    prepareBtn.addEventListener('click', prepareRobot);
}

if (startBtn) {
    startBtn.addEventListener('click', startStrategy);
}

if (stopBtn) {
    stopBtn.addEventListener('click', stopStrategy);
}

window.addEventListener('beforeunload', () => {
    if (strategyEventSource) strategyEventSource.close();
    if (pathfindingEventSource) pathfindingEventSource.close();
    if (pamiEventSource) pamiEventSource.close();
    disconnectAllEspTopics();
});

// Stop interval when page is hidden to save CPU
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        stopUpdateDisplayInterval();
    } else {
        startUpdateDisplayInterval();
        updateLastUpdateDisplay(); // Update immediately when becoming visible
    }
});

// Throttle resize events for performance
let resizeTimeout = null;
window.addEventListener('resize', () => {
    if (resizeTimeout) clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        if (robotMarker && robotPose.x !== 0) {
            updateRobotMarker();
        }
        if (enemyRobotMarker && enemyRobot) {
            updateEnemyRobotMarker();
        }
        if (obstacles.length > 0) {
            drawObstacles();
        }
        if (currentPath.length > 0) {
            drawPath();
        }
        resizeTimeout = null;
    }, 250); // Debounce resize to 250ms
});

console.log('✅ Real-time robot tracking initialized');
