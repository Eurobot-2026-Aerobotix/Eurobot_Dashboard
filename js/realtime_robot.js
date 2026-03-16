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
let robotMarker = null;
let enemyRobotMarker = null;  // Marker for enemy robot
let lastUpdateTime = null;
let trailEnabled = true;
let maxTrailPoints = 50;
let currentPath = [];  // Store current planned path from hybrid A*

// Throttling for enemy robot updates (prevent browser lag from high-frequency lidar data)
let lastEnemyUpdateTime = 0;
const ENEMY_UPDATE_THROTTLE_MS = 100;  // Update enemy display max once every 100ms (10Hz)

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
        
        // Subscribe to path visualization
        subscribeToPathVisualization();
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
        // Extract path points from MarkerArray
        currentPath = [];
        
        if (message.markers && message.markers.length > 0) {
            // Find the path marker (first marker with LINE_STRIP type)
            const pathMarker = message.markers.find(m => m.type === 4);  // LINE_STRIP = 4
            
            if (pathMarker && pathMarker.points) {
                // Convert points to our coordinate system
                currentPath = pathMarker.points.map(point => ({
                    x: point.x,  // Already in meters
                    y: point.y   // Already in meters
                }));
                
                console.log(`✅ Received path with ${currentPath.length} waypoints`);
                
                // Draw the path
                drawPath();
            }
        } else {
            // Clear path if empty marker array
            currentPath = [];
            drawPath();
        }
    });
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
    
    mapWrapper.appendChild(enemyRobotMarker);
    
    console.log('✅ Robot markers initialized');
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
        
        // Use actual width and height from ROS message
        // IMPORTANT: Since we swap x/y coordinates, we also need to swap width/height
        const width_mm = obstacle.height_mm || 50;
        const height_mm = obstacle.width_mm || 50;
        
        // Calculate dimensions in pixels (scaled)
        const width_px = (width_mm / MAP_WIDTH_MM) * displayWidth;
        const height_px = (height_mm / MAP_HEIGHT_MM) * displayHeight;
        
        // Obstacle coordinates are center-based, so anchor marker from center
        const center_x_px = pos_x_px;
        const center_y_px = pos_y_px;
        
        // Create obstacle marker
        const obstacleMarker = document.createElement('div');
        obstacleMarker.className = 'obstacle-marker ' + obstacle.color;
        obstacleMarker.style.position = 'absolute';
        obstacleMarker.style.left = center_x_px + 'px';
        obstacleMarker.style.top = center_y_px + 'px';
        obstacleMarker.style.width = width_px + 'px';
        obstacleMarker.style.height = height_px + 'px';
        obstacleMarker.style.transform = 'translate(-50%, -50%)';
        obstacleMarker.style.zIndex = '50';
        obstacleMarker.style.pointerEvents = 'none';
        obstacleMarker.title = `Color: ${obstacle.color}\nPosition: (${obstacle.x.toFixed(1)}mm, ${obstacle.y.toFixed(1)}mm)`;
        
        mapWrapper.appendChild(obstacleMarker);
    });
}

function drawPath() {
    // Remove existing path visualization
    const existingPath = mapWrapper.querySelector('.path-visualization');
    if (existingPath) {
        existingPath.remove();
    }
    
    if (currentPath.length === 0) {
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
    
    // Create path element
    const pathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    
    // Build SVG path data
    let pathData = '';
    currentPath.forEach((point, index) => {
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
    pathElement.setAttribute('stroke', '#00ff00');
    pathElement.setAttribute('stroke-width', '3');
    pathElement.setAttribute('fill', 'none');
    pathElement.setAttribute('stroke-linecap', 'round');
    pathElement.setAttribute('stroke-linejoin', 'round');
    
    svg.appendChild(pathElement);
    mapWrapper.appendChild(svg);
    
    console.log(`✅ Drew path with ${currentPath.length} waypoints`);
}

function updateObstacleCount() {
    obstacleCountDisplay.textContent = obstacles.length;
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
