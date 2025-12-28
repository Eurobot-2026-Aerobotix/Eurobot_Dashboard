// Configuration
const MAP_WIDTH_MM = 3000;  // 3000mm = 3m
const MAP_HEIGHT_MM = 2000; // 2000mm = 2m
const MAP_WIDTH_PX = 3000;  // pixels
const MAP_HEIGHT_PX = 2000; // pixels

// ROS2 Bridge Configuration - use dynamic hostname
const API_HOST = window.location.hostname || '10.42.0.1';
const ROSBRIDGE_URL = `ws://${API_HOST}:9090`;
let ros = null;
let isConnected = false;

// State
let currentMode = null; // 'start', 'enemy', or 'goal'
let pendingPose = null;
let poses = {
    start: null,
    enemy: null,
    goal: null
};
let obstacles = []; // Store obstacles from YAML
let batches = [];   // Store batch information
let batchVisibility = {}; // Track which batches are visible
let isAddingBatch = false; // Track if we're in "add batch" mode
let pendingBatch = null; // Store batch being created

// DOM Elements
const mapWrapper = document.getElementById('mapWrapper');
const map = document.getElementById('map');
const startPoseBtn = document.getElementById('startPoseBtn');
const enemyPoseBtn = document.getElementById('enemyPoseBtn');
const goalPoseBtn = document.getElementById('goalPoseBtn');
const findPathBtn = document.getElementById('findPathBtn');
const orientationSelector = document.getElementById('orientationSelector');
const orientationInput = document.getElementById('orientationInput');
const confirmBtn = document.getElementById('confirmBtn');
const orientationBtns = document.querySelectorAll('.orientation-btn');
const batchList = document.getElementById('batchList');
const toggleAllBtn = document.getElementById('toggleAllBtn');
const addBatchBtn = document.getElementById('addBatchBtn');
const sendBatchesBtn = document.getElementById('sendBatchesBtn');
const batchModal = document.getElementById('batchModal');
const modalClose = document.getElementById('modalClose');
const batchForm = document.getElementById('batchForm');
const cancelBatchBtn = document.getElementById('cancelBatchBtn');
const saveBatchBtn = document.getElementById('saveBatchBtn');

// Initialize ROS2 Bridge
initROS();

// Load obstacles and batches on page load
loadObstacles();

// Load saved state from localStorage
loadSavedState();

// Initialize
startPoseBtn.addEventListener('click', () => activateMode('start'));
enemyPoseBtn.addEventListener('click', () => activateMode('enemy'));
goalPoseBtn.addEventListener('click', () => activateMode('goal'));
findPathBtn.addEventListener('click', findPath);
mapWrapper.addEventListener('click', handleMapClick);
confirmBtn.addEventListener('click', confirmPose);
toggleAllBtn.addEventListener('click', toggleAllBatches);
addBatchBtn.addEventListener('click', startAddBatch);
sendBatchesBtn.addEventListener('click', sendBatches);
modalClose.addEventListener('click', closeModal);
cancelBatchBtn.addEventListener('click', cancelBatch);
saveBatchBtn.addEventListener('click', saveBatch);

// Orientation button handlers
orientationBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const angle = btn.dataset.angle;
        orientationInput.value = angle;
        
        // Update selected state
        orientationBtns.forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        
        if (pendingPose) {
            updateMarkerOrientation(pendingPose.marker, angle);
        }
    });
});

// Manual orientation input
orientationInput.addEventListener('input', () => {
    orientationBtns.forEach(b => b.classList.remove('selected'));
    if (pendingPose) {
        updateMarkerOrientation(pendingPose.marker, orientationInput.value);
    }
});

// Update robot models on window resize
window.addEventListener('resize', () => {
    updateAllRobotModels();
});

function updateAllRobotModels() {
    // Update start robot if exists
    if (poses.start) {
        const oldRobot = document.querySelector('.robot-model.start');
        if (oldRobot) {
            oldRobot.remove();
            const startMarker = document.querySelector('.marker.start');
            if (startMarker) {
                createRobotModel(
                    startMarker.style.left.replace('px', ''),
                    startMarker.style.top.replace('px', ''),
                    poses.start.theta,
                    'start'
                );
            }
        }
    }
    
    // Update enemy robot if exists
    if (poses.enemy) {
        const oldRobot = document.querySelector('.robot-model.enemy');
        if (oldRobot) {
            oldRobot.remove();
            const enemyMarker = document.querySelector('.marker.enemy');
            if (enemyMarker) {
                createRobotModel(
                    enemyMarker.style.left.replace('px', ''),
                    enemyMarker.style.top.replace('px', ''),
                    poses.enemy.theta,
                    'enemy'
                );
            }
        }
    }
    
    // Update goal robot if exists
    if (poses.goal) {
        const oldRobot = document.querySelector('.robot-model.goal');
        if (oldRobot) {
            oldRobot.remove();
            const goalMarker = document.querySelector('.marker.goal');
            if (goalMarker) {
                createRobotModel(
                    goalMarker.style.left.replace('px', ''),
                    goalMarker.style.top.replace('px', ''),
                    poses.goal.theta,
                    'goal'
                );
            }
        }
    }
}

async function loadObstacles() {
    try {
        const response = await fetch('../resources/obstacles.yaml');
        const yamlText = await response.text();
        
        // Simple YAML parser for this specific format
        const data = parseYAML(yamlText);
        
        if (data.batches) {
            data.batches.forEach(batch => {
                // Store batch information
                batches.push({
                    batch_id: batch.batch_id,
                    known_id: batch.known_id,
                    direction: batch.direction,
                    count: batch.count
                });
                
                // Initialize batch visibility (all visible by default)
                batchVisibility[batch.batch_id] = true;
                
                if (batch.members) {
                    batch.members.forEach(member => {
                        obstacles.push({
                            aruco_id: member.aruco_id,
                            x: member.map_pos.x,
                            y: member.map_pos.y,
                            color: member.color,
                            batch_id: batch.batch_id,
                            direction: batch.direction  // Add direction from batch
                        });
                    });
                }
            });
        }
        
        // Draw obstacles on map
        drawObstacles();
        
        // Populate batch selector
        populateBatchSelector();
        
        console.log(`Loaded ${obstacles.length} obstacles in ${batches.length} batches`);
    } catch (error) {
        console.error('Error loading obstacles:', error);
    }
}

function parseYAML(yamlText) {
    // Simple YAML parser for the specific format
    const data = { batches: [] };
    const lines = yamlText.split('\n');
    let currentBatch = null;
    let currentMember = null;
    let inMapPos = false;
    let mapPosData = {};
    
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        if (!line || line.startsWith('#')) continue;
        
        if (line.includes('- batch_id:')) {
            currentBatch = { members: [] };
            currentBatch.batch_id = parseInt(line.split(':')[1]);
            data.batches.push(currentBatch);
        } else if (line.includes('known_id:') && currentBatch && !line.includes('-')) {
            currentBatch.known_id = line.split(':')[1].trim().replace(/"/g, '');
        } else if (line.includes('count:') && currentBatch) {
            currentBatch.count = parseInt(line.split(':')[1]);
        } else if (line.includes('direction:') && currentBatch) {
            currentBatch.direction = line.split(':')[1].trim().replace(/"/g, '');
        } else if (line.includes('- aruco_id:') && currentBatch) {
            currentMember = {};
            currentMember.aruco_id = parseInt(line.split(':')[1]);
            currentBatch.members.push(currentMember);
            inMapPos = false;
        } else if (line === 'map_pos:' && currentMember) {
            inMapPos = true;
            mapPosData = {};
        } else if (inMapPos && line.startsWith('x:')) {
            mapPosData.x = parseFloat(line.split(':')[1].trim());
        } else if (inMapPos && line.startsWith('y:')) {
            mapPosData.y = parseFloat(line.split(':')[1].trim());
        } else if (inMapPos && line.startsWith('z:')) {
            mapPosData.z = parseFloat(line.split(':')[1].trim());
            currentMember.map_pos = { ...mapPosData };
            inMapPos = false;
        } else if (line.includes('color:') && currentMember) {
            currentMember.color = line.split(':')[1].trim().replace(/"/g, '');
        }
    }
    
    return data;
}

function drawObstacles() {
    const displayWidth = map.offsetWidth;
    const displayHeight = map.offsetHeight;
    
    // Obstacle dimensions in mm
    const OBSTACLE_LONG_MM = 150;   // Long side
    const OBSTACLE_SHORT_MM = 50;   // Short side
    
    obstacles.forEach(obstacle => {
        // Convert mm to pixel coordinates (with x/y swap)
        // map_pos is the center position
        const center_x_px = (obstacle.y / MAP_WIDTH_MM) * displayWidth;
        const center_y_px = (obstacle.x / MAP_HEIGHT_MM) * displayHeight;
        
        // Determine width and height based on direction
        let width_mm, height_mm;
        if (obstacle.direction === 'vertical') {
            // Vertical: narrow width, tall height (stacked vertically)
            width_mm = OBSTACLE_SHORT_MM;
            height_mm = OBSTACLE_LONG_MM;
        } else if (obstacle.direction === 'horizontal') {
            // Horizontal: wide width, short height (side by side)
            width_mm = OBSTACLE_LONG_MM;
            height_mm = OBSTACLE_SHORT_MM;
        } else {
            // Default to square if direction unknown
            width_mm = OBSTACLE_SHORT_MM;
            height_mm = OBSTACLE_SHORT_MM;
        }
        
        // Calculate dimensions in pixels (with x/y swap for dimensions too)
        const width_px = (width_mm / MAP_WIDTH_MM) * displayWidth;
        const height_px = (height_mm / MAP_HEIGHT_MM) * displayHeight;
        
        // Create obstacle marker
        const obstacleMarker = document.createElement('div');
        obstacleMarker.className = 'obstacle-marker';
        obstacleMarker.dataset.batchId = obstacle.batch_id;  // Add batch ID as data attribute
        obstacleMarker.style.left = center_x_px + 'px';
        obstacleMarker.style.top = center_y_px + 'px';
        obstacleMarker.style.position = 'absolute';
        obstacleMarker.style.width = width_px + 'px';
        obstacleMarker.style.height = height_px + 'px';
        obstacleMarker.style.transform = 'translate(-50%, -50%)';
        obstacleMarker.style.borderRadius = '4px'; // Slight rounding for rectangles
        obstacleMarker.style.border = '2px solid #333';
        obstacleMarker.style.zIndex = '5';
        obstacleMarker.style.pointerEvents = 'none';
        obstacleMarker.style.fontSize = '9px';
        obstacleMarker.style.display = 'flex';
        obstacleMarker.style.alignItems = 'center';
        obstacleMarker.style.justifyContent = 'center';
        obstacleMarker.style.fontWeight = 'bold';
        obstacleMarker.style.boxShadow = '0 2px 4px rgba(0,0,0,0.3)';
        
        // Set color
        if (obstacle.color === 'yellow') {
            obstacleMarker.style.backgroundColor = '#FFD700';
            obstacleMarker.style.color = '#000';
        } else if (obstacle.color === 'blue') {
            obstacleMarker.style.backgroundColor = '#4169E1';
            obstacleMarker.style.color = '#fff';
        }
        
        // Add ArUco ID
        obstacleMarker.textContent = obstacle.aruco_id;
        obstacleMarker.title = `ArUco ID: ${obstacle.aruco_id}\nColor: ${obstacle.color}\nPosition: (${obstacle.x}, ${obstacle.y})\nDirection: ${obstacle.direction}\nSize: ${width_mm}x${height_mm}mm`;
        
        mapWrapper.appendChild(obstacleMarker);
    });
}

function populateBatchSelector() {
    batchList.innerHTML = '';
    
    batches.forEach(batch => {
        const batchItem = document.createElement('div');
        batchItem.className = 'batch-item';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'batch-checkbox';
        checkbox.id = `batch-${batch.batch_id}`;
        checkbox.checked = batchVisibility[batch.batch_id];
        checkbox.addEventListener('change', () => toggleBatchVisibility(batch.batch_id));
        
        const label = document.createElement('label');
        label.className = 'batch-label';
        label.htmlFor = `batch-${batch.batch_id}`;
        label.textContent = batch.known_id || `Batch ${batch.batch_id}`;
        
        const count = document.createElement('span');
        count.className = 'batch-count';
        count.textContent = `${batch.count} items`;
        
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'batch-delete-btn';
        deleteBtn.innerHTML = '🗑️';
        deleteBtn.title = 'Delete batch';
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteBatch(batch.batch_id, batch.known_id);
        });
        
        batchItem.appendChild(checkbox);
        batchItem.appendChild(label);
        batchItem.appendChild(count);
        batchItem.appendChild(deleteBtn);
        
        batchList.appendChild(batchItem);
    });
}

function toggleBatchVisibility(batchId) {
    batchVisibility[batchId] = !batchVisibility[batchId];
    
    // Save to localStorage
    saveBatchVisibilityToStorage();
    
    // Update obstacle markers visibility using data attribute
    const obstacleMarkers = document.querySelectorAll(`.obstacle-marker[data-batch-id="${batchId}"]`);
    obstacleMarkers.forEach(marker => {
        if (batchVisibility[batchId]) {
            marker.classList.remove('hidden');
        } else {
            marker.classList.add('hidden');
        }
    });
}

function toggleAllBatches() {
    const allChecked = batches.every(batch => batchVisibility[batch.batch_id]);
    
    // Toggle all to opposite state
    batches.forEach(batch => {
        batchVisibility[batch.batch_id] = !allChecked;
        const checkbox = document.getElementById(`batch-${batch.batch_id}`);
        if (checkbox) {
            checkbox.checked = !allChecked;
        }
        
        // Update markers for this batch
        const obstacleMarkers = document.querySelectorAll(`.obstacle-marker[data-batch-id="${batch.batch_id}"]`);
        obstacleMarkers.forEach(marker => {
            if (!allChecked) {
                marker.classList.remove('hidden');
            } else {
                marker.classList.add('hidden');
    
    // Save to localStorage
    saveBatchVisibilityToStorage();
            }
        });
    });
}

function activateMode(mode) {
    currentMode = mode;
    
    // Update button states
    startPoseBtn.classList.toggle('active', mode === 'start');
    enemyPoseBtn.classList.toggle('active', mode === 'enemy');
    goalPoseBtn.classList.toggle('active', mode === 'goal');
    
    // Hide orientation selector
    orientationSelector.style.display = 'none';
    
    // Clear pending pose
    if (pendingPose && pendingPose.marker) {
        pendingPose.marker.remove();
    }
    pendingPose = null;

    // Remove old marker for this mode
    const oldMarker = document.querySelector(`.marker.${mode}`);
    if (oldMarker) {
        oldMarker.remove();
    }

    // Remove old robot model for this mode
    const oldRobot = document.querySelector(`.robot-model.${mode}`);
    if (oldRobot) {
        oldRobot.remove();
    }
}

function handleMapClick(event) {
    // Handle batch placement
    if (isAddingBatch && !pendingBatch) {
        handleBatchPlacement(event);
        return;
    }
    
    // Original pose placement logic
    if (!currentMode) return;
    
    // Only handle clicks on the map image or map wrapper, not on other elements
    if (event.target.classList.contains('obstacle-marker') || 
        event.target.closest('.obstacle-marker') ||
        event.target.classList.contains('marker') ||
        event.target.closest('.marker')) {
        return;
    }

    // Get click position relative to map
    const rect = map.getBoundingClientRect();
    const x_px = event.clientX - rect.left;
    const y_px = event.clientY - rect.top;

    // Convert to actual map coordinates (mm)
    const displayWidth = map.offsetWidth;
    const displayHeight = map.offsetHeight;
    
    const x_mm = (y_px / displayHeight) * MAP_HEIGHT_MM;
    const y_mm = (x_px / displayWidth) * MAP_WIDTH_MM;

    // Round to 1 decimal place
    const x = Math.round(x_mm * 10) / 10;
    const y = Math.round(y_mm * 10) / 10;

    // Remove old pending marker if exists
    if (pendingPose && pendingPose.marker) {
        pendingPose.marker.remove();
    }

    // Remove old robot model for the current mode (we're replacing it)
    const oldRobot = document.querySelector(`.robot-model.${currentMode}`);
    if (oldRobot) {
        oldRobot.remove();
    }

    // Create marker
    const marker = createMarker(x_px, y_px, currentMode);
    
    // Store pending pose
    pendingPose = {
        x: x,
        y: y,
        theta: 0,
        marker: marker,
        type: currentMode
    };

    // Show orientation selector
    orientationSelector.style.display = 'block';
    orientationInput.value = '0';
    orientationBtns.forEach(b => b.classList.remove('selected'));
}

function createMarker(x_px, y_px, type) {
    const marker = document.createElement('div');
    marker.className = `marker ${type}`;
    marker.style.left = x_px + 'px';
    marker.style.top = y_px + 'px';
    
    marker.innerHTML = `
        <div class="marker-inner">
            <div class="marker-circle"></div>
            <div class="marker-arrow"></div>
        </div>
    `;
    
    mapWrapper.appendChild(marker);
    return marker;
}

function updateMarkerOrientation(marker, angle) {
    const arrow = marker.querySelector('.marker-arrow');
    // Your coordinate system: 0° = down, 90° = right, counter-clockwise
    // CSS rotate: 0° = up, positive = clockwise
    // Conversion: CSS_angle = -angle (to flip direction) + 180 (to start from down instead of up)
    arrow.style.transform = `translate(-50%, -50%) rotate(${-angle + 180}deg)`;
}

function createRobotModel(x_px, y_px, angle, type) {
    // Robot size: 300mm x 300mm
    const ROBOT_SIZE_MM = 300;
    const map = document.getElementById('map');
    const mapWidth_px = map.offsetWidth;
    const mapHeight_px = map.offsetHeight;
    
    // Calculate scale: pixels per mm
    const scaleX = mapWidth_px / MAP_WIDTH_MM;
    const scaleY = mapHeight_px / MAP_HEIGHT_MM;
    const scale = Math.min(scaleX, scaleY);
    
    const robotSize_px = ROBOT_SIZE_MM * scale;
    
    const robot = document.createElement('div');
    robot.className = `robot-model ${type}`;
    robot.style.left = x_px + 'px';
    robot.style.top = y_px + 'px';
    robot.style.width = robotSize_px + 'px';
    robot.style.height = robotSize_px + 'px';
    
    // Apply rotation
    // Your coordinate system: 0° = down, 90° = right, counter-clockwise
    // CSS rotate: 0° = up, positive = clockwise
    const cssAngle = -angle + 180;
    robot.style.transform = `translate(-50%, -50%) rotate(${cssAngle}deg)`;
    
    robot.innerHTML = `
        <div class="robot-body">
            <div class="robot-front"></div>
        </div>
    `;
    
    mapWrapper.appendChild(robot);
    return robot;
}

function confirmPose() {
    if (!pendingPose) return;

    const theta = parseFloat(orientationInput.value) || 0;
    pendingPose.theta = theta;

    // Remove old robot model for this type if it exists
    const oldRobot = document.querySelector(`.robot-model.${pendingPose.type}`);
    if (oldRobot) {
        oldRobot.remove();
    }

    // Create robot model at the confirmed position
    createRobotModel(
        pendingPose.marker.style.left.replace('px', ''),
        pendingPose.marker.style.top.replace('px', ''),
        theta,
        pendingPose.type
    );

    // Store the pose
    poses[pendingPose.type] = {
        x: pendingPose.x,
        y: pendingPose.y,
        theta: theta
    };

    // Save to localStorage
    savePoseToStorage(pendingPose.type);

    // Update display
    updatePoseDisplay(pendingPose.type, pendingPose.x, pendingPose.y, theta);

    // Call appropriate function
    if (pendingPose.type === 'start') {
        send_start();
    } else if (pendingPose.type === 'enemy') {
        send_enemy();
    } else if (pendingPose.type === 'goal') {
        send_goal();
    }

    // Clean up
    orientationSelector.style.display = 'none';
    currentMode = null;
    startPoseBtn.classList.remove('active');
    enemyPoseBtn.classList.remove('active');
    goalPoseBtn.classList.remove('active');
    pendingPose = null;
}

function updatePoseDisplay(type, x, y, theta) {
    if (type === 'start') {
        document.getElementById('startX').textContent = `X: ${x.toFixed(1)} mm`;
        document.getElementById('startY').textContent = `Y: ${y.toFixed(1)} mm`;
        document.getElementById('startTheta').textContent = `θ: ${theta.toFixed(1)}°`;
    } else if (type === 'enemy') {
        document.getElementById('enemyX').textContent = `X: ${x.toFixed(1)} mm`;
        document.getElementById('enemyY').textContent = `Y: ${y.toFixed(1)} mm`;
        document.getElementById('enemyTheta').textContent = `θ: ${theta.toFixed(1)}°`;
    } else if (type === 'goal') {
        document.getElementById('goalX').textContent = `X: ${x.toFixed(1)} mm`;
        document.getElementById('goalY').textContent = `Y: ${y.toFixed(1)} mm`;
        document.getElementById('goalTheta').textContent = `θ: ${theta.toFixed(1)}°`;
    }
}

// -------------------------------------------------
// ROS2 Bridge Functions
// -------------------------------------------------

function initROS() {
    console.log('🔌 Connecting to ROS2 Bridge...');
    
    ros = new ROSLIB.Ros({
        url: ROSBRIDGE_URL
    });

    ros.on('connection', function() {
        console.log('✅ Connected to ROS2 Bridge');
        isConnected = true;
        updateConnectionStatus(true);
    });

    ros.on('error', function(error) {
        console.error('❌ ROS2 Bridge Error:', error);
        isConnected = false;
        updateConnectionStatus(false);
    });

    ros.on('close', function() {
        console.warn('⚠️ ROS2 Bridge connection closed');
        isConnected = false;
        updateConnectionStatus(false);
        
        // Auto-reconnect after 3 seconds
        setTimeout(() => {
            console.log('🔄 Attempting to reconnect...');
            initROS();
        }, 3000);
    });
}

function updateConnectionStatus(connected) {
    // You can add a visual indicator in your HTML
    const statusIndicator = document.getElementById('rosStatus');
    if (statusIndicator) {
        statusIndicator.textContent = connected ? '🟢 Connected' : '🔴 Disconnected';
        statusIndicator.style.color = connected ? 'green' : 'red';
    }
}

function send_start() {
    if (!isConnected || !poses.start) {
        console.warn('⚠️ Cannot send start pose: Not connected or pose not set');
        return;
    }
    
    console.log('📤 Sending start pose:', poses.start);
    
    const topic = new ROSLIB.Topic({
        ros: ros,
        name: '/web/start_pose',
        messageType: 'std_msgs/String'
    });
    
    // Convert mm to m, keep degrees
    const message = new ROSLIB.Message({
        data: JSON.stringify({
            x: poses.start.x,  // mm
            y: poses.start.y,  // mm
            theta: poses.start.theta  // degrees
        })
    });
    
    topic.publish(message);
    console.log('✅ Start pose sent');
}

function send_enemy() {
    if (!isConnected || !poses.enemy) {
        console.warn('⚠️ Cannot send enemy pose: Not connected or pose not set');
        return;
    }
    
    console.log('📤 Sending enemy pose:', poses.enemy);
    
    const topic = new ROSLIB.Topic({
        ros: ros,
        name: '/web/enemy_pose',
        messageType: 'std_msgs/String'
    });
    
    // Convert mm to m, keep degrees
    const message = new ROSLIB.Message({
        data: JSON.stringify({
            x: poses.enemy.x,  // mm
            y: poses.enemy.y,  // mm
            theta: poses.enemy.theta  // degrees
        })
    });
    
    topic.publish(message);
    console.log('✅ Enemy pose sent');
}

function send_goal() {
    if (!isConnected || !poses.goal) {
        console.warn('⚠️ Cannot send goal pose: Not connected or pose not set');
        return;
    }
    
    console.log('📤 Sending goal pose:', poses.goal);
    
    const topic = new ROSLIB.Topic({
        ros: ros,
        name: '/web/goal_pose',
        messageType: 'std_msgs/String'
    });
    
    // Convert mm to m, keep degrees
    const message = new ROSLIB.Message({
        data: JSON.stringify({
            x: poses.goal.x,  // mm
            y: poses.goal.y,  // mm
            theta: poses.goal.theta  // degrees
        })
    });
    
    topic.publish(message);
    console.log('✅ Goal pose sent');
}

function findPath() {
    if (!isConnected) {
        console.warn('⚠️ Cannot compute path: Not connected to ROS2');
        alert('Not connected to ROS2. Please check the connection.');
        return;
    }
    
    if (!poses.start || !poses.goal) {
        console.warn('⚠️ Cannot compute path: Start or goal pose not set');
        alert('Please set both start and goal poses first.');
        return;
    }
    
    console.log('🔍 Computing path...');
    console.log('Start:', poses.start);
    console.log('Goal:', poses.goal);
    console.log('Enemy:', poses.enemy);
    
    const topic = new ROSLIB.Topic({
        ros: ros,
        name: '/web/compute_path',
        messageType: 'std_msgs/String'
    });
    
    const message = new ROSLIB.Message({
        data: JSON.stringify({
            command: 'compute_path'
        })
    });
    
    topic.publish(message);
    console.log('✅ Path computation requested');
    
    // Listen for path result
    subscribeToPathResult();
}

function subscribeToPathResult() {
    const listener = new ROSLIB.Topic({
        ros: ros,
        name: '/web/path_result',
        messageType: 'std_msgs/String'
    });
    
    listener.subscribe(function(message) {
        try {
            const result = JSON.parse(message.data);
            console.log('📥 Path result received:', result);
            
            if (result.success) {
                console.log('✅ Path found!');
                console.log('Path length:', result.path_length_m, 'm');
                console.log('Planning time:', result.planning_time_ms, 'ms');
                
                // The result has 'path' not 'waypoints'
                const waypoints = result.path || result.waypoints || [];
                console.log('Waypoints:', waypoints.length);
                
                if (waypoints.length > 0) {
                    // Draw path on map
                    drawPath(waypoints);
                } else {
                    console.warn('⚠️ No waypoints in path result');
                }
            } else {
                console.error('❌ Path computation failed:', result.message);
                alert('Path computation failed: ' + result.message);
            }
        } catch (error) {
            console.error('Error parsing path result:', error);
        }
        
        // Unsubscribe after receiving result
        listener.unsubscribe();
    });
}

function drawPath(waypoints) {
    // Remove existing path
    const existingPath = document.querySelector('.path-line');
    if (existingPath) {
        existingPath.remove();
    }
    
    if (!waypoints || waypoints.length === 0) {
        console.warn('⚠️ No waypoints to draw');
        return;
    }
    
    console.log('📊 Drawing path with', waypoints.length, 'waypoints');
    console.log('First waypoint:', waypoints[0]);
    console.log('Last waypoint:', waypoints[waypoints.length - 1]);
    
    const displayWidth = map.offsetWidth;
    const displayHeight = map.offsetHeight;
    
    // Create SVG for path
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('path-line');
    svg.style.position = 'absolute';
    svg.style.top = '0';
    svg.style.left = '0';
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.pointerEvents = 'none';
    svg.style.zIndex = '10';
    
    // Convert waypoints to path
    let pathData = '';
    waypoints.forEach((wp, index) => {
        // Waypoint can be [x, y, theta] array or {x, y, theta} object
        let x_mm, y_mm;
        
        if (Array.isArray(wp)) {
            x_mm = wp[0];
            y_mm = wp[1];
        } else {
            x_mm = wp.x;
            y_mm = wp.y;
        }
        
        // Waypoints are already in mm, just convert to pixels
        // Swap x/y for coordinate system
        const x_px = (y_mm / MAP_WIDTH_MM) * displayWidth;
        const y_px = (x_mm / MAP_HEIGHT_MM) * displayHeight;
        
        console.log(`Waypoint ${index}: [${x_mm.toFixed(1)}mm, ${y_mm.toFixed(1)}mm] -> [${x_px.toFixed(1)}px, ${y_px.toFixed(1)}px]`);
        
        if (index === 0) {
            pathData += `M ${x_px} ${y_px}`;
        } else {
            pathData += ` L ${x_px} ${y_px}`;
        }
    });
    
    console.log('📐 SVG path data:', pathData);
    
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathData);
    path.setAttribute('stroke', '#00ff00');
    path.setAttribute('stroke-width', '4');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('opacity', '0.8');
    
    svg.appendChild(path);
    mapWrapper.appendChild(svg);
    
    console.log('✅ Path drawn on map with', waypoints.length, 'points');
}

// -------------------------------------------------
// Batch Creation Functions
// -------------------------------------------------

function startAddBatch() {
    isAddingBatch = true;
    batchModal.classList.add('active');
    mapWrapper.style.cursor = 'crosshair';
    
    // Deactivate other modes
    currentMode = null;
    startPoseBtn.classList.remove('active');
    enemyPoseBtn.classList.remove('active');
    goalPoseBtn.classList.remove('active');
    orientationSelector.style.display = 'none';
    
    // Show instruction
    document.querySelector('.modal-instruction').style.display = 'block';
    batchForm.style.display = 'none';
    
    console.log('Click on the map to place the batch center');
}

function closeModal() {
    batchModal.classList.remove('active');
    isAddingBatch = false;
    mapWrapper.style.cursor = 'crosshair';
    
    // Clear pending batch preview
    if (pendingBatch && pendingBatch.previewElement) {
        pendingBatch.previewElement.remove();
    }
    pendingBatch = null;
    
    // Reset form
    document.getElementById('batchKnownId').value = '';
    document.getElementById('batchDirection').value = 'vertical';
    document.getElementById('color1').value = 'yellow';
    document.getElementById('color2').value = 'blue';
    document.getElementById('color3').value = 'yellow';
    document.getElementById('color4').value = 'blue';
    document.querySelector('.modal-instruction').style.display = 'block';
    document.querySelector('.modal-instruction').textContent = 'Click on the map to place the batch center';
    batchForm.style.display = 'none';
}

function cancelBatch() {
    closeModal();
}

function handleBatchPlacement(event) {
    // Only handle clicks on the map image, not on other elements
    if (event.target !== map && event.target !== mapWrapper) {
        return;
    }
    
    const rect = map.getBoundingClientRect();
    const x_px = event.clientX - rect.left;
    const y_px = event.clientY - rect.top;
    
    // Convert to actual map coordinates (mm)
    const displayWidth = map.offsetWidth;
    const displayHeight = map.offsetHeight;
    
    const x_mm = (y_px / displayHeight) * MAP_HEIGHT_MM;
    const y_mm = (x_px / displayWidth) * MAP_WIDTH_MM;
    
    // Round to 1 decimal place
    const x = Math.round(x_mm * 10) / 10;
    const y = Math.round(y_mm * 10) / 10;
    
    // Store batch center position
    pendingBatch = {
        center: { x, y, z: 0.0 },
        center_px: { x: x_px, y: y_px }
    };
    
    // Show batch preview
    showBatchPreview(x_px, y_px, 'vertical');
    
    // Show form
    batchForm.style.display = 'flex';
    document.querySelector('.modal-instruction').textContent = 'Configure batch properties:';
}

function showBatchPreview(centerX_px, centerY_px, direction) {
    // Remove existing preview
    const existingPreview = document.querySelector('.batch-preview');
    if (existingPreview) {
        existingPreview.remove();
    }
    
    const displayWidth = map.offsetWidth;
    const displayHeight = map.offsetHeight;
    
    // Batch dimensions
    const OBSTACLE_LONG_MM = 150;
    const OBSTACLE_SHORT_MM = 50;
    const SPACING_MM = 50; // Distance between centers of adjacent rectangles
    
    // Create preview container
    const preview = document.createElement('div');
    preview.className = 'batch-preview';
    
    // Calculate member positions based on direction
    let positions = [];
    if (direction === 'vertical') {
        // Vertical: rectangles stacked vertically (same X, varying Y)
        const width_mm = OBSTACLE_SHORT_MM;
        const height_mm = OBSTACLE_LONG_MM;
        const width_px = (width_mm / MAP_WIDTH_MM) * displayWidth;
        const height_px = (height_mm / MAP_HEIGHT_MM) * displayHeight;
        const spacing_px = (SPACING_MM / MAP_HEIGHT_MM) * displayHeight;
        
        positions = [
            { x: centerX_px, y: centerY_px - spacing_px * 1.5, w: width_px, h: height_px },
            { x: centerX_px, y: centerY_px - spacing_px * 0.5, w: width_px, h: height_px },
            { x: centerX_px, y: centerY_px + spacing_px * 0.5, w: width_px, h: height_px },
            { x: centerX_px, y: centerY_px + spacing_px * 1.5, w: width_px, h: height_px }
        ];
    } else {
        // Horizontal: rectangles side by side horizontally (same Y, varying X)
        const width_mm = OBSTACLE_LONG_MM;
        const height_mm = OBSTACLE_SHORT_MM;
        const width_px = (width_mm / MAP_WIDTH_MM) * displayWidth;
        const height_px = (height_mm / MAP_HEIGHT_MM) * displayHeight;
        const spacing_px = (SPACING_MM / MAP_WIDTH_MM) * displayWidth;
        
        positions = [
            { x: centerX_px - spacing_px * 1.5, y: centerY_px, w: width_px, h: height_px },
            { x: centerX_px - spacing_px * 0.5, y: centerY_px, w: width_px, h: height_px },
            { x: centerX_px + spacing_px * 0.5, y: centerY_px, w: width_px, h: height_px },
            { x: centerX_px + spacing_px * 1.5, y: centerY_px, w: width_px, h: height_px }
        ];
    }
    
    // Create member previews
    positions.forEach((pos, index) => {
        const member = document.createElement('div');
        member.className = 'batch-preview-member';
        member.style.left = pos.x + 'px';
        member.style.top = pos.y + 'px';
        member.style.width = pos.w + 'px';
        member.style.height = pos.h + 'px';
        member.style.transform = 'translate(-50%, -50%)';
        member.textContent = index + 1;
        preview.appendChild(member);
    });
    
    mapWrapper.appendChild(preview);
    
    // Store preview element
    if (pendingBatch) {
        pendingBatch.previewElement = preview;
        pendingBatch.direction = direction;
    }
}

// Update preview when direction changes
document.getElementById('batchDirection').addEventListener('change', (e) => {
    if (pendingBatch && pendingBatch.center_px) {
        showBatchPreview(pendingBatch.center_px.x, pendingBatch.center_px.y, e.target.value);
    }
});

async function saveBatch() {
    // Validate form
    const knownId = document.getElementById('batchKnownId').value.trim();
    const direction = document.getElementById('batchDirection').value;
    const colors = [
        document.getElementById('color1').value,
        document.getElementById('color2').value,
        document.getElementById('color3').value,
        document.getElementById('color4').value
    ];
    
    // Automatically assign ArUco IDs based on color
    // Yellow = 47, Blue = 36
    const arucoIds = colors.map(color => color === 'yellow' ? 47 : 36);
    
    // Validation
    if (!knownId) {
        console.log('Known ID is required');
        return;
    }
    
    // Calculate member positions
    const SPACING_MM = 50;
    const members = [];
    
    for (let i = 0; i < 4; i++) {
        let memberPos;
        if (direction === 'vertical') {
            // Vertical arrangement - same X, varying Y
            const offset = (i - 1.5) * SPACING_MM;
            memberPos = {
                x: pendingBatch.center.x,
                y: pendingBatch.center.y + offset,
                z: 0.0
            };
        } else {
            // Horizontal arrangement - same Y, varying X
            const offset = (i - 1.5) * SPACING_MM;
            memberPos = {
                x: pendingBatch.center.x + offset,
                y: pendingBatch.center.y,
                z: 0.0
            };
        }
        
        members.push({
            aruco_id: arucoIds[i],
            map_pos: memberPos,
            color: colors[i]
        });
    }
    
    // Create batch object
    const newBatch = {
        known_id: knownId,
        count: 4,
        direction: direction,
        phi_deg: direction === 'vertical' ? 0.0 : 90.0,
        avg_adjacent_dist_m: 0.05,
        center: pendingBatch.center,
        members: members
    };
    
    // Save to server
    try {
        const API_HOST = window.location.hostname || 'localhost';
        const response = await fetch(`http://${API_HOST}:8000/obstacles/batch`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(newBatch)
        });
        
        if (!response.ok) {
            throw new Error('Failed to save batch');
        }
        
        const result = await response.json();
        console.log('Batch saved:', result);
        
        // Add to local state
        newBatch.batch_id = result.batch_id;
        batches.push({
            batch_id: newBatch.batch_id,
            known_id: newBatch.known_id,
            direction: newBatch.direction,
            count: newBatch.count
        });
        
        // Add obstacles
        members.forEach(member => {
            obstacles.push({
                aruco_id: member.aruco_id,
                x: member.map_pos.x,
                y: member.map_pos.y,
                color: member.color,
                batch_id: newBatch.batch_id,
                direction: direction
            });
        });
        
        // Initialize visibility
        batchVisibility[newBatch.batch_id] = true;
        
        // Redraw obstacles
        const existingObstacles = document.querySelectorAll('.obstacle-marker');
        existingObstacles.forEach(marker => marker.remove());
        drawObstacles();
        
        // Update batch selector
        populateBatchSelector();
        
        // Close modal
        closeModal();
        
        console.log(`Batch "${knownId}" saved successfully!`);
    } catch (error) {
        console.error('Error saving batch:', error);
        console.log('Error saving batch. Please try again.');
    }
}

// -------------------------------------------------
// Send Batches Function
// -------------------------------------------------

function sendBatches() {
    if (!isConnected) {
        console.warn('⚠️ Cannot send batches: Not connected to ROS2');
        alert('Not connected to ROS2. Please check the connection.');
        return;
    }
    
    // Get all selected (visible) batches
    const selectedBatches = batches.filter(batch => batchVisibility[batch.batch_id]);
    
    if (selectedBatches.length === 0) {
        console.warn('⚠️ No batches selected!');
        alert('No batches selected. Please select at least one batch.');
        return;
    }
    
    // Build the batches table with full details
    const batchesTable = selectedBatches.map(batch => {
        // Find all obstacles (members) for this batch
        const batchMembers = obstacles.filter(obs => obs.batch_id === batch.batch_id);
        
        return {
            batch_id: batch.batch_id,
            known_id: batch.known_id,
            direction: batch.direction,
            count: batch.count,
            members: batchMembers.map(member => ({
                aruco_id: member.aruco_id,
                position: {
                    x: member.x,  // mm
                    y: member.y   // mm
                },
                color: member.color
            }))
        };
    });
    
    console.log('📤 Sending batches to ROS2:', batchesTable);
    console.log('Total selected batches:', selectedBatches.length);
    console.log('Total members:', batchesTable.reduce((sum, b) => sum + b.members.length, 0));
    
    // Send to ROS2 via rosbridge
    const topic = new ROSLIB.Topic({
        ros: ros,
        name: '/web/send_batches',
        messageType: 'std_msgs/String'
    });
    
    const message = new ROSLIB.Message({
        data: JSON.stringify({
            batches: batchesTable
        })
    });
    
    topic.publish(message);
    console.log('✅ Batches sent to ROS2');
    alert(`Successfully sent ${selectedBatches.length} batches to ROS2!`);
    
    // Return the batches table for further use
    return batchesTable;
}

// -------------------------------------------------
// Delete Batch Function
// -------------------------------------------------

async function deleteBatch(batchId, knownId) {
    try {
        // Call server to delete batch from YAML
        const API_HOST = window.location.hostname || 'localhost';
        const response = await fetch(`http://${API_HOST}:8000/obstacles/batch/${batchId}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) {
            throw new Error('Failed to delete batch');
        }
        
        const result = await response.json();
        console.log('🗑️ Batch deleted:', result);
        
        // Remove from local state
        const batchIndex = batches.findIndex(b => b.batch_id === batchId);
        if (batchIndex !== -1) {
            batches.splice(batchIndex, 1);
        }
        
        // Remove obstacles for this batch
        obstacles = obstacles.filter(obs => obs.batch_id !== batchId);
        
        // Remove visibility state
        delete batchVisibility[batchId];
        
        // Redraw obstacles
        const existingObstacles = document.querySelectorAll('.obstacle-marker');
        existingObstacles.forEach(marker => marker.remove());
        drawObstacles();
        
        // Update batch selector
        populateBatchSelector();
        
        console.log(`✅ Batch "${knownId}" deleted successfully!`);
        
    } catch (error) {
        console.error('Error deleting batch:', error);
    }
}

// -------------------------------------------------
// LocalStorage Persistence Functions
// -------------------------------------------------

function savePoseToStorage(type) {
    if (poses[type]) {
        localStorage.setItem(`pathfinding_${type}_pose`, JSON.stringify(poses[type]));
    }
}

function saveBatchVisibilityToStorage() {
    localStorage.setItem('pathfinding_batch_visibility', JSON.stringify(batchVisibility));
}

function loadSavedState() {
    // Wait for obstacles to load first
    setTimeout(() => {
        // Load poses
        ['start', 'enemy', 'goal'].forEach(type => {
            const savedPose = localStorage.getItem(`pathfinding_${type}_pose`);
            if (savedPose) {
                try {
                    const pose = JSON.parse(savedPose);
                    poses[type] = pose;
                    
                    // Convert mm to px for display
                    const displayWidth = map.offsetWidth;
                    const displayHeight = map.offsetHeight;
                    const x_px = (pose.y / MAP_WIDTH_MM) * displayWidth;
                    const y_px = (pose.x / MAP_HEIGHT_MM) * displayHeight;
                    
                    // Create marker
                    const marker = createMarker(x_px, y_px, type);
                    updateMarkerOrientation(marker, pose.theta);
                    
                    // Create robot model
                    createRobotModel(x_px, y_px, pose.theta, type);
                    
                    // Update display
                    updatePoseDisplay(type, pose.x, pose.y, pose.theta);
                } catch (e) {
                    console.error(`Error loading ${type} pose:`, e);
                }
            }
        });
        
        // Load batch visibility
        const savedVisibility = localStorage.getItem('pathfinding_batch_visibility');
        if (savedVisibility) {
            try {
                const visibility = JSON.parse(savedVisibility);
                
                // Apply saved visibility
                Object.keys(visibility).forEach(batchId => {
                    if (batchVisibility.hasOwnProperty(batchId)) {
                        batchVisibility[batchId] = visibility[batchId];
                        
                        // Update checkbox
                        const checkbox = document.getElementById(`batch-${batchId}`);
                        if (checkbox) {
                            checkbox.checked = visibility[batchId];
                        }
                        
                        // Update markers
                        const obstacleMarkers = document.querySelectorAll(`.obstacle-marker[data-batch-id="${batchId}"]`);
                        obstacleMarkers.forEach(marker => {
                            if (visibility[batchId]) {
                                marker.classList.remove('hidden');
                            } else {
                                marker.classList.add('hidden');
                            }
                        });
                    }
                });
            } catch (e) {
                console.error('Error loading batch visibility:', e);
            }
        }
    }, 500); // Wait for obstacles to be drawn
}

// -------------------------------------------------
// Batch Creation Functions
// -------------------------------------------------
