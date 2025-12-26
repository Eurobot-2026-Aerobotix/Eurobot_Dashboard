// Configuration
const MAP_WIDTH_MM = 3000;  // 3000mm = 3m
const MAP_HEIGHT_MM = 2000; // 2000mm = 2m
const MAP_WIDTH_PX = 3000;  // pixels
const MAP_HEIGHT_PX = 2000; // pixels

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

// Load obstacles and batches on page load
loadObstacles();

// Initialize
startPoseBtn.addEventListener('click', () => activateMode('start'));
enemyPoseBtn.addEventListener('click', () => activateMode('enemy'));
goalPoseBtn.addEventListener('click', () => activateMode('goal'));
findPathBtn.addEventListener('click', findPath);
mapWrapper.addEventListener('click', handleMapClick);
confirmBtn.addEventListener('click', confirmPose);
toggleAllBtn.addEventListener('click', toggleAllBatches);

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
    
    for (let line of lines) {
        line = line.trim();
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
        } else if (line.includes('map_pos:') && currentMember) {
            const match = line.match(/x:\s*([\d.]+).*y:\s*([\d.]+)/);
            if (match) {
                currentMember.map_pos = {
                    x: parseFloat(match[1]),
                    y: parseFloat(match[2])
                };
            }
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
            // Vertical: wide width, short height
            width_mm = OBSTACLE_LONG_MM;
            height_mm = OBSTACLE_SHORT_MM;
        } else if (obstacle.direction === 'horizontal') {
            // Horizontal: narrow width, tall height
            width_mm = OBSTACLE_SHORT_MM;
            height_mm = OBSTACLE_LONG_MM;
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
        
        batchItem.appendChild(checkbox);
        batchItem.appendChild(label);
        batchItem.appendChild(count);
        
        batchList.appendChild(batchItem);
    });
}

function toggleBatchVisibility(batchId) {
    batchVisibility[batchId] = !batchVisibility[batchId];
    
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

// Functions to be implemented later
function send_start() {
    console.log('send_start() called');
    console.log('Start Pose:', poses.start);
}

function send_enemy() {
    console.log('send_enemy() called');
    console.log('Enemy Pose:', poses.enemy);
}

function send_goal() {
    console.log('send_goal() called');
    console.log('Goal Pose:', poses.goal);
}

function findPath() {
    // TODO: Implement pathfinding logic
    console.log('findPath() called');
    console.log('Start:', poses.start);
    console.log('Goal:', poses.goal);
    console.log('Enemy:', poses.enemy);
    console.log('Obstacles:', obstacles);
}
