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
let robotMarker = null;
let lastUpdateTime = null;
let trailEnabled = true;
let maxTrailPoints = 50;
let receivingRosObstacles = false; // Track if we're receiving ROS obstacle data

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

// Initialize ROS2 Bridge
initROS();

// Initialize on page load
window.addEventListener('load', async () => {
    // Wait for map to load before creating robot marker
    if (map.complete) {
        initializeRobotMarker();
        // Load obstacles after map is ready
        setTimeout(async () => {
            await loadObstaclesFromServer();
        }, 500);
    } else {
        map.addEventListener('load', async () => {
            initializeRobotMarker();
            // Load obstacles after map is ready
            setTimeout(async () => {
                await loadObstaclesFromServer();
            }, 500);
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
        robotPose.theta = message.z; // z is the orientation in radians
        
        // Update display
        updateRobotDisplay();
        
        // Update robot marker on map
        updateRobotMarker();
        
        // Update last update time
        lastUpdateTime = new Date();
        updateLastUpdateDisplay();
    });
}

function subscribeToObstacles() {
    console.log('📡 Subscribing to obstacle data from ROS topic');
    
    // Subscribe to obstacles topic from pathfinding_node
    // The pathfinding_node publishes ObstacleArray to /obstacles/current
    const obstacleListener = new ROSLIB.Topic({
        ros: ros,
        name: '/obstacles/current',
        messageType: 'hybrid_astar/ObstacleArray'
    });
    
    obstacleListener.subscribe(function(message) {
        try {
            console.log('📥 Received obstacle data from ROS topic (/obstacles/current)');
            console.log('Message structure:', message);
            
            // Mark that we're receiving ROS obstacles (disable server polling)
            receivingRosObstacles = true;
            
            // Clear all existing obstacles
            obstacles = [];
            
            // Process obstacles from ObstacleArray message
            if (message.obstacles) {
                message.obstacles.forEach(obs => {
                    // Check if the obstacle has valid data
                    if (obs.pose && typeof obs.pose.x !== 'undefined' && typeof obs.pose.y !== 'undefined') {
                        // Only add non-wall obstacles
                        if (obs.color !== 'wall') {
                            obstacles.push({
                                aruco_id: obs.id || '',
                                x: obs.pose.x, // Already in mm
                                y: obs.pose.y, // Already in mm
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
            
            console.log(`✅ Updated obstacles from ROS: ${obstacles.length} obstacles`);
            drawObstacles();
            updateObstacleCount();
        } catch (error) {
            console.error('Error parsing obstacle data from ROS:', error);
        }
    });
    
    // Also load obstacles from the server API initially
    loadObstaclesFromServer();
}

async function loadObstaclesFromServer() {
    try {
        console.log('🔄 Fetching obstacles from server...');
        const response = await fetch(`${API_URL}/obstacles`);
        if (!response.ok) {
            throw new Error('Failed to load obstacles');
        }
        
        const data = await response.json();
        
        // Clear all existing obstacles first
        obstacles = [];
        
        // Process batches into flat obstacle array
        if (data.batches) {
            data.batches.forEach(batch => {
                if (batch.members) {
                    batch.members.forEach(member => {
                        obstacles.push({
                            aruco_id: member.aruco_id,
                            x: member.map_pos.x,
                            y: member.map_pos.y,
                            color: member.color,
                            batch_id: batch.batch_id,
                            direction: batch.direction
                        });
                    });
                }
            });
        }
        
        console.log(`✅ Loaded ${obstacles.length} obstacles from server`);
        drawObstacles();
        updateObstacleCount();
        
    } catch (error) {
        console.error('❌ Error loading obstacles:', error);
    }
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
    
    console.log('✅ Robot marker initialized');
}

function updateRobotDisplay() {
    // Update info overlay
    robotXDisplay.textContent = robotPose.x.toFixed(3);
    robotYDisplay.textContent = robotPose.y.toFixed(3);
    
    // Convert radians to degrees for display
    const thetaDeg = (robotPose.theta * 180 / Math.PI).toFixed(1);
    robotThetaDisplay.textContent = thetaDeg;
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
    robotMarker.style.transform = `translate(-50%, -50%) rotate(${-robotPose.theta}rad)`;
    robotMarker.style.display = 'flex';
    
    // Add trail effect
    if (trailEnabled) {
        addTrailPoint(x_px, y_px);
    }
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
        console.log('⚠️ No obstacles to draw');
        return;
    }
    
    // Wait for map to be loaded and have dimensions
    if (!map.complete || map.offsetWidth === 0 || map.offsetHeight === 0) {
        console.log('⏳ Waiting for map to load before drawing obstacles...');
        setTimeout(drawObstacles, 100);
        return;
    }
    
    const displayWidth = map.offsetWidth;
    const displayHeight = map.offsetHeight;
    
    console.log(`📊 Drawing ${obstacles.length} obstacles on map (${displayWidth}x${displayHeight}px)`);
    console.log(`Map position - offsetTop: ${map.offsetTop}px, offsetLeft: ${map.offsetLeft}px`);
    console.log(`Map-wrapper position - offsetTop: ${mapWrapper.offsetTop}px, offsetLeft: ${mapWrapper.offsetLeft}px`);
    
    obstacles.forEach((obstacle, index) => {
        // Obstacle positions are already in mm (not meters!)
        const x_mm = obstacle.x;
        const y_mm = obstacle.y;
        
        // Convert to pixel coordinates (with x/y swap)
        // Scale from mm to actual displayed pixels
        // Position relative to the map image (which is at 0,0 within map-wrapper)
        const pos_x_px = (y_mm / MAP_WIDTH_MM) * displayWidth;
        const pos_y_px = (x_mm / MAP_HEIGHT_MM) * displayHeight;
        
        // Use actual width and height from ROS message
        // IMPORTANT: Since we swap x/y coordinates, we also need to swap width/height
        const width_mm = obstacle.height_mm || 50;
        const height_mm = obstacle.width_mm || 50;
        
        // Calculate dimensions in pixels (scaled)
        const width_px = (width_mm / MAP_WIDTH_MM) * displayWidth;
        const height_px = (height_mm / MAP_HEIGHT_MM) * displayHeight;
        
        // Position is the left-top corner of the obstacle
        // CSS left/top also positions the top-left corner, so use directly
        const left_px = pos_x_px;
        const top_px = pos_y_px;
        
        console.log(`Obstacle ${index}: [${obstacle.x.toFixed(1)}mm, ${obstacle.y.toFixed(1)}mm] -> [${left_px.toFixed(1)}px, ${top_px.toFixed(1)}px] ${width_px.toFixed(1)}x${height_px.toFixed(1)}px ${obstacle.color} ${obstacle.direction}`);
        
        // Create obstacle marker
        const obstacleMarker = document.createElement('div');
        obstacleMarker.className = 'obstacle-marker ' + obstacle.color;
        obstacleMarker.style.position = 'absolute';
        obstacleMarker.style.left = left_px + 'px';
        obstacleMarker.style.top = top_px + 'px';
        obstacleMarker.style.width = width_px + 'px';
        obstacleMarker.style.height = height_px + 'px';
        obstacleMarker.style.transform = 'none';
        obstacleMarker.style.zIndex = '50';
        obstacleMarker.style.pointerEvents = 'none';
        obstacleMarker.textContent = obstacle.aruco_id || '';
        obstacleMarker.title = `ArUco ID: ${obstacle.aruco_id}\nColor: ${obstacle.color}\nPosition: (${obstacle.x.toFixed(1)}mm, ${obstacle.y.toFixed(1)}mm)`;
        
        console.log(`Creating obstacle element:`, obstacleMarker);
        mapWrapper.appendChild(obstacleMarker);
        console.log(`Obstacle ${index} appended to mapWrapper, total children: ${mapWrapper.children.length}`);
    });
    
    console.log(`✅ Drew ${obstacles.length} obstacles on map`);
}

function updateObstacleCount() {
    obstacleCountDisplay.textContent = obstacles.length;
}

function updateLastUpdateDisplay() {
    if (!lastUpdateTime) return;
    
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

// Update last update display every second
setInterval(updateLastUpdateDisplay, 1000);

// Reload obstacles from server only if NOT receiving ROS data (fallback)
setInterval(async () => {
    if (isConnected && !receivingRosObstacles) {
        console.log('📡 No ROS obstacle data, falling back to server polling...');
        await loadObstaclesFromServer();
    }
}, 1000);

// Handle window resize
window.addEventListener('resize', () => {
    if (robotMarker && robotPose.x !== 0) {
        updateRobotMarker();
    }
    if (obstacles.length > 0) {
        drawObstacles();
    }
});

console.log('✅ Real-time robot tracking initialized');
