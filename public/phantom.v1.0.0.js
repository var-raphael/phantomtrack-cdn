/**
 * PhantomTrack - Universal Analytics with Callback Support
 * One script tag. Any website. Zero config.
 * Supports: plain HTML, Next.js, React, Vue, SvelteKit, and any SPA.
 */
(function() {
    'use strict';
    
    if (window.__phantomTrackInitialized) {
        return;
    }
    window.__phantomTrackInitialized = true;
    
    let trackId = null;
    let endpoint = null;
    
    if (document.currentScript && document.currentScript.src) {
        try {
            const url = new URL(document.currentScript.src);
            trackId = url.searchParams.get('trackid');
            
            const customEndpoint = url.searchParams.get('endpoint');
            if (customEndpoint) {
                endpoint = customEndpoint;
            }
        } catch (e) {
            // Ignore error
        }
    }
    
    if (!trackId) {
        const scripts = document.getElementsByTagName('script');
        
        for (let i = scripts.length - 1; i >= 0; i--) {
            const src = scripts[i].src;
            
            if (src && src.includes('phantom.js')) {
                try {
                    const url = new URL(src);
                    const paramValue = url.searchParams.get('trackid');
                    
                    if (paramValue) {
                        trackId = paramValue;
                        
                        const customEndpoint = url.searchParams.get('endpoint');
                        if (customEndpoint) {
                            endpoint = customEndpoint;
                        }
                        break;
                    }
                } catch (e) {
                    // Ignore error
                }
            }
        }
    }
    
    if (!endpoint) {
        const currentHost = window.location.hostname;
        
        if (currentHost === 'localhost' || currentHost === '127.0.0.1' || currentHost.startsWith('192.168.')) {
            endpoint = 'track';
        } else {
            endpoint = 'https://phantomtrack.xyz/track';
        }
    }
    
    if (!trackId || !/^track_[a-zA-Z0-9]{20,30}$/.test(trackId)) {
        return;
    }
    
    const INACTIVITY_THRESHOLD = 30000;
    const HEARTBEAT_INTERVAL = 30000;
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 2000;
    
    let sessionId = generateSessionId();
    let activeTime = 0;
    let lastActivityTime = Date.now();
    let isActive = true;
    let heartbeatTimer = null;
    let inactivityTimer = null;
    let currentPath = window.location.pathname;
    
    function generateSessionId() {
        let randomPart;
        
        if (window.crypto && window.crypto.getRandomValues) {
            const array = new Uint32Array(2);
            window.crypto.getRandomValues(array);
            randomPart = array[0].toString(36) + array[1].toString(36);
        } else {
            randomPart = Math.random().toString(36).substr(2, 9);
        }
        
        return 'sess_' + Date.now() + '_' + randomPart.substr(0, 12);
    }
    
    function getDeviceType() {
        try {
            const ua = navigator.userAgent || '';
            
            if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) {
                return 'tablet';
            }
            if (/Mobile|Android|iP(hone|od)|IEMobile|BlackBerry|Kindle|Silk-Accelerated|(hpw|web)OS|Opera M(obi|ini)/.test(ua)) {
                return 'mobile';
            }
            
            return 'desktop';
        } catch (e) {
            return 'unknown';
        }
    }
    
    function getScreenResolution() {
        try {
            const width = screen.width || 0;
            const height = screen.height || 0;
            
            if (width > 0 && height > 0 && width < 100000 && height < 100000) {
                return width + 'x' + height;
            }
        } catch (e) {
            // Ignore error
        }
        
        return 'unknown';
    }
    
    function sanitizeURL(url) {
        if (typeof url !== 'string') return '';
        
        try {
            const urlObj = new URL(url);
            urlObj.username = '';
            urlObj.password = '';
            
            const sanitized = urlObj.toString();
            return sanitized.length > 2048 ? sanitized.substr(0, 2048) : sanitized;
        } catch (e) {
            return url.substr(0, 2048);
        }
    }
    
    function collectPageData() {
        return {
            trackid: trackId,
            session_id: sessionId,
            page_url: sanitizeURL(window.location.href),
            referrer: sanitizeURL(document.referrer) || 'direct',
            device_type: getDeviceType(),
            screen_resolution: getScreenResolution(),
            user_agent: (navigator.userAgent || '').substr(0, 500)
        };
    }
    
    function sendData(eventType, additionalData, retryCount, callback) {
        retryCount = retryCount || 0;
        
        const data = {
            ...collectPageData(),
            event_type: eventType,
            ...additionalData
        };
        
        // Try sendBeacon for leave/end events (no callback support)
        if ((eventType === 'leave' || eventType === 'pageview_end') && navigator.sendBeacon) {
            try {
                const blob = new Blob([JSON.stringify(data)], { type: 'text/plain' });
                const sent = navigator.sendBeacon(endpoint, blob);
                
                if (sent) {
                    if (callback && typeof callback === 'function') {
                        try {
                            callback(true, null);
                        } catch (e) {
                            // Ignore callback errors
                        }
                    }
                    return;
                }
            } catch (e) {
                // Fallback to fetch
            }
        }
        
        // Use text/plain to avoid CORS preflight
        fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain'
            },
            body: JSON.stringify(data),
            keepalive: true
        })
        .then(function(response) {
            if (response.ok) {
                return response.json().catch(function() {
                    return { success: true };
                });
            } else if (response.status === 429) {
                if (retryCount < MAX_RETRIES) {
                    setTimeout(function() {
                        sendData(eventType, additionalData, retryCount + 1, callback);
                    }, RETRY_DELAY * (retryCount + 1));
                } else {
                    throw new Error('Rate limited after retries');
                }
            } else {
                throw new Error('HTTP ' + response.status);
            }
        })
        .then(function(result) {
            if (callback && typeof callback === 'function') {
                try {
                    callback(true, result);
                } catch (e) {
                    // Ignore callback errors
                }
            }
        })
        .catch(function(error) {
            if (retryCount < MAX_RETRIES) {
                setTimeout(function() {
                    sendData(eventType, additionalData, retryCount + 1, callback);
                }, RETRY_DELAY * (retryCount + 1));
            } else {
                if (callback && typeof callback === 'function') {
                    try {
                        callback(false, error);
                    } catch (e) {
                        // Ignore callback errors
                    }
                }
            }
        });
    }
    
    function updateActiveTime() {
        if (isActive && document.visibilityState === 'visible') {
            const now = Date.now();
            const timeSinceLastActivity = now - lastActivityTime;
            
            if (timeSinceLastActivity > 0 && timeSinceLastActivity < INACTIVITY_THRESHOLD) {
                activeTime += timeSinceLastActivity;
            }
            
            lastActivityTime = now;
        }
    }
    
    function markActive() {
        const now = Date.now();
        
        if (!isActive) {
            isActive = true;
            lastActivityTime = now;
        } else {
            const timeSinceLastActivity = now - lastActivityTime;
            
            if (timeSinceLastActivity > 0 && timeSinceLastActivity < INACTIVITY_THRESHOLD) {
                activeTime += timeSinceLastActivity;
            }
            
            lastActivityTime = now;
        }
        
        clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(markInactive, INACTIVITY_THRESHOLD);
    }
    
    function markInactive() {
        if (isActive) {
            updateActiveTime();
            isActive = false;
        }
    }
    
    function sendHeartbeat() {
        if (document.visibilityState === 'visible') {
            sendData('heartbeat', {
                is_active: isActive
            });
        }
    }
    
    function startHeartbeat() {
        if (heartbeatTimer) return;
        heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);
    }
    
    function stopHeartbeat() {
        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        }
    }
    
    function handleVisibilityChange() {
        try {
            if (document.visibilityState === 'hidden') {
                markInactive();
                stopHeartbeat();
            } else {
                markActive();
                startHeartbeat();
            }
        } catch (e) {
            // Ignore error
        }
    }
    
    function handlePageLeave() {
        try {
            if (window.__phantomPageLeft) return;
            window.__phantomPageLeft = true;
            
            updateActiveTime();
            const timeSpent = Math.round(activeTime / 1000);
            
            sendData('pageview_end', {
                timespent: timeSpent
            });
            
            sendData('leave');
            
        } catch (e) {
            // Ignore error
        }
    }

    // ── SPA route change detection ─────────────────────────────────────────────
    // Works for Next.js (<Link>), React Router, Vue Router, SvelteKit, and any
    // framework that uses history.pushState for client-side navigation.
    // Without this, the script only fires once on initial load and misses all
    // subsequent page navigations since the browser never reloads the page.

    function handleRouteChange() {
        try {
            // Only fire if the path actually changed — ignore hash/query-only changes
            const newPath = window.location.pathname;
            if (newPath === currentPath) return;
            currentPath = newPath;

            // End session for the page we just left
            updateActiveTime();
            const timeSpent = Math.round(activeTime / 1000);
            sendData('pageview_end', { timespent: timeSpent });

            // Reset all state for the new page
            activeTime = 0;
            lastActivityTime = Date.now();
            isActive = true;
            window.__phantomPageLeft = false;
            sessionId = generateSessionId();

            // Small delay so window.location.href reflects the new URL
            setTimeout(function() {
                sendData('pageview');
            }, 0);

        } catch (e) {
            // Ignore error
        }
    }

    // Patch history.pushState — this is what Next.js <Link>, React Router
    // <Link>, and most SPA routers call internally on every navigation.
    // The browser fires no native event for pushState so we intercept it here.
    const _pushState = history.pushState.bind(history);
    history.pushState = function(state, title, url) {
        _pushState(state, title, url);
        handleRouteChange();
    };

    // Patch history.replaceState too — covers redirects and replace navigations
    const _replaceState = history.replaceState.bind(history);
    history.replaceState = function(state, title, url) {
        _replaceState(state, title, url);
        handleRouteChange();
    };

    // popstate fires on browser back/forward button clicks
    window.addEventListener('popstate', handleRouteChange, { passive: true });

    // ── End SPA route change detection ────────────────────────────────────────
    
    window.phantom = {
        /**
         * Track custom events with optional callback
         * @param {string} eventName - Name of the event to track
         * @param {object} properties - Optional properties object
         * @param {function} callback - Optional callback function(success, result)
         *
         * Usage:
         * phantom.track('button_clicked');
         * phantom.track('purchase', { amount: 50 });
         * phantom.track('signup', { plan: 'pro' }, function(success, result) {
         *     if (success) window.location.href = '/dashboard';
         * });
         */
        track: function(eventName, properties, callback) {
            try {
                if (!eventName || typeof eventName !== 'string') {
                    return;
                }
                
                if (typeof properties === 'function' && !callback) {
                    callback = properties;
                    properties = {};
                }
                
                if (eventName.length > 100) {
                    eventName = eventName.substr(0, 100);
                }
                
                properties = properties || {};
                
                let propertiesJSON;
                try {
                    propertiesJSON = JSON.stringify(properties);
                    
                    if (propertiesJSON.length > 10000) {
                        if (callback && typeof callback === 'function') {
                            callback(false, new Error('Properties too large'));
                        }
                        return;
                    }
                } catch (e) {
                    if (callback && typeof callback === 'function') {
                        callback(false, e);
                    }
                    return;
                }
                
                sendData('custom_event', {
                    event_name: eventName,
                    event_properties: propertiesJSON
                }, 0, callback);
                
            } catch (e) {
                if (callback && typeof callback === 'function') {
                    try {
                        callback(false, e);
                    } catch (err) {
                        // Ignore callback errors
                    }
                }
            }
        },
        
        getSessionId: function() {
            return sessionId;
        },
        
        version: '1.2.0'
    };
    
    // Alias for backward compatibility
    window.phantom.event = window.phantom.track;
    
    function init() {
        try {
            sendData('pageview');
            
            const activityEvents = [
                'mousedown',
                'mousemove',
                'keypress',
                'scroll',
                'touchstart',
                'click'
            ];
            
            activityEvents.forEach(function(event) {
                document.addEventListener(event, markActive, {
                    passive: true,
                    capture: false
                });
            });
            
            document.addEventListener('visibilitychange', handleVisibilityChange, {
                passive: true
            });
            
            window.addEventListener('beforeunload', handlePageLeave, {
                capture: true
            });
            window.addEventListener('pagehide', handlePageLeave, {
                passive: true
            });
            
            inactivityTimer = setTimeout(markInactive, INACTIVITY_THRESHOLD);
            
            startHeartbeat();
            setTimeout(sendHeartbeat, 1000);
            
        } catch (e) {
            // Ignore error
        }
    }
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        setTimeout(init, 0);
    }
    
})();
