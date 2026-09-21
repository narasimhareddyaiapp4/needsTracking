import React, { useRef, useEffect, forwardRef, useImperativeHandle, useState, useCallback } from 'react';
import UniversalWebView from './UniversalWebView';
import { StyleSheet, View, Platform } from 'react-native';

const SimpleLeafletMap = forwardRef(({ 
  initialRegion, 
  markerCoordinate, 
  userLocations = [],
  onMarkerDragEnd,
  onMapPress 
}, ref) => {
  const webViewRef = useRef(null);
  const [isMapReady, setIsMapReady] = useState(false);
  
  // Store initial data only - don't update after map is loaded
  const [initialMapData] = useState({
    initialRegion: initialRegion || { latitude: 28.6139, longitude: 77.2090 },
    markerCoordinate: markerCoordinate || initialRegion || { latitude: 28.6139, longitude: 77.2090 },
    userLocations
  });

  // Send commands to existing map instead of reloading
  const sendMessageToWebView = useCallback((message) => {
    if (webViewRef.current) {
      if (webViewRef.current.injectJavaScript) {
        webViewRef.current.injectJavaScript(message);
      } else if (webViewRef.current.postMessage) {
        webViewRef.current.postMessage(message);
      }
    }
  }, []);

  // Update route if userLocations changed
  useEffect(() => {
    if (!isMapReady) return;

    sendMessageToWebView(`
      if (window.mapFunctions && window.mapFunctions.updateRoute) {
        window.mapFunctions.updateRoute(${JSON.stringify(userLocations)});
      }
    `);
  }, [userLocations, sendMessageToWebView, isMapReady]);

  // Update marker position if markerCoordinate changed
  useEffect(() => {
    if (!isMapReady || !markerCoordinate) return;

    sendMessageToWebView(`
      if (window.mapFunctions && window.mapFunctions.updateMarker) {
        window.mapFunctions.updateMarker(${markerCoordinate.latitude}, ${markerCoordinate.longitude});
      }
    `);
  }, [markerCoordinate, sendMessageToWebView, isMapReady]);

  // Create dynamic HTML with embedded data
  const createMapHtml = (data) => {
    return `
<!DOCTYPE html>
<html>
<head>
  <title>Leaflet Map</title>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css" crossorigin=""/>
  <script src="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js" crossorigin=""></script>
  <style>
    html, body, #map {
      height: 100%;
      width: 100%;
      margin: 0;
      padding: 0;
      background-color: #f2f2f2;
    }
    .leaflet-control-attribution {
      font-size: 10px;
    }
    .custom-location-pin {
      background-color: #007AFF;
      border: 2px solid #FFFFFF;
      border-radius: 50%;
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    const mapData = ${JSON.stringify(data)};
    
    let map;
    let marker;
    let routePolyline;
    let locationMarkers = [];

    // Helper to send messages back to React Native or Web parent
    function postToNative(data) {
      const json = JSON.stringify(data);
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(json);
      }
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(json, '*');
      }
    }

    // Configure default leaflet marker icons to CDN to prevent 404s
    delete L.Icon.Default.prototype._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-icon-2x.png',
      iconUrl: 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-icon.png',
      shadowUrl: 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/images/marker-shadow.png',
    });

    function setupMarker(lat, lng) {
      if (marker) {
        marker.setLatLng([lat, lng]);
      } else {
        marker = L.marker([lat, lng], { 
          draggable: true,
          title: 'Selected Location'
        }).addTo(map);
        
        marker.on('dragend', function(e) {
          const latLng = e.target.getLatLng();
          postToNative({
            type: 'markerDragEnd',
            latitude: latLng.lat,
            longitude: latLng.lng
          });
        });
      }
    }

    function initializeMap() {
      try {
        if (map) return;

        var southWest = L.latLng(-85, -180);
        var northEast = L.latLng(85, 180);
        var worldBounds = L.latLngBounds(southWest, northEast);

        map = L.map('map', {
          zoomControl: true,
          attributionControl: true,
          minZoom: 3,
          maxZoom: 19,
          maxBounds: worldBounds,
          maxBoundsViscosity: 1.0,
          worldCopyJump: false
        });
        
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          minZoom: 3,
          noWrap: true,
          bounds: worldBounds,
          attribution: '© OpenStreetMap contributors'
        }).addTo(map);

        if (mapData.initialRegion && mapData.initialRegion.latitude && mapData.initialRegion.longitude) {
          const { latitude, longitude } = mapData.initialRegion;
          map.setView([latitude, longitude], 14);
          
          if (mapData.markerCoordinate && mapData.markerCoordinate.latitude && mapData.markerCoordinate.longitude) {
            setupMarker(mapData.markerCoordinate.latitude, mapData.markerCoordinate.longitude);
          } else {
            setupMarker(latitude, longitude);
          }
        } else {
          map.setView([28.6139, 77.2090], 12);
        }

        if (mapData.userLocations && mapData.userLocations.length > 0) {
          updateRoute(mapData.userLocations);
        }

        // Tap/click on map immediately places marker and notifies parent
        map.on('click', function(e) {
          const lat = e.latlng.lat;
          const lng = e.latlng.lng;
          setupMarker(lat, lng);
          postToNative({
            type: 'mapClick',
            latitude: lat,
            longitude: lng
          });
        });

        // Notify parent that map is ready
        postToNative({ type: 'mapReady' });
        console.log('Map initialized successfully');
      } catch (error) {
        console.error('Error initializing map:', error);
      }
    }

    function centerOnLocation(latitude, longitude, zoom = 15) {
      if (!map) return; 
      map.setView([latitude, longitude], zoom, {
        animate: true,
        duration: 0.5
      });
      setupMarker(latitude, longitude);
    }

    function updateMarker(latitude, longitude) {
      if (!map) return; 
      setupMarker(latitude, longitude);
    }

    function clearUserLocations() {
      if (!map) return; 
      if (routePolyline) {
        map.removeLayer(routePolyline);
        routePolyline = null;
      }
      locationMarkers.forEach(m => map.removeLayer(m));
      locationMarkers = [];
    }

    function updateRoute(locations) {
      if (!map || !locations || locations.length === 0) {
        clearUserLocations();
        return;
      }
      clearUserLocations();
      const routeCoords = locations.map(loc => [loc.latitude, loc.longitude]);
      routePolyline = L.polyline(routeCoords, {
        color: '#007AFF',
        weight: 4,
        opacity: 0.8
      }).addTo(map);
      
      locations.forEach((location, index) => {
        const locationMarker = L.circleMarker([location.latitude, location.longitude], {
          radius: 5,
          fillColor: index === 0 ? '#34C759' : (index === locations.length - 1 ? '#FF3B30' : '#007AFF'),
          color: '#ffffff',
          weight: 2,
          opacity: 1,
          fillOpacity: 0.9
        }).addTo(map);
        locationMarkers.push(locationMarker);
      });
    }

    function fitToRoute() {
      if (!map || !routePolyline) return; 
      const bounds = routePolyline.getBounds();
      map.fitBounds(bounds.pad(0.1), {
        animate: true,
        duration: 0.5
      });
    }

    function handleIncoming(e) {
      try {
        var data = e.data !== undefined ? e.data : e;
        if (typeof data === 'string') {
          try { data = JSON.parse(data); } catch(err) { return; }
        }
        if (!data) return;
        if (data.type === 'EVAL_SCRIPT' && data.script) {
          try { eval(data.script); } catch(err) { console.error('EVAL_SCRIPT error:', err); }
        } else if (data.type === 'CENTER_ON_LOCATION') {
          centerOnLocation(data.latitude, data.longitude, data.zoom || 15);
        } else if (data.type === 'UPDATE_MARKER') {
          updateMarker(data.latitude, data.longitude);
        } else if (data.type === 'CLEAR_USER_LOCATIONS') {
          clearUserLocations();
        } else if (data.type === 'UPDATE_ROUTE') {
          updateRoute(data.locations);
        } else if (data.type === 'FIT_TO_ROUTE') {
          fitToRoute();
        }
      } catch(err) {
        console.error('handleIncoming error in LeafletMap:', err);
      }
    }

    window.addEventListener('message', handleIncoming);
    document.addEventListener('message', handleIncoming);

    window.mapFunctions = {
      centerOnLocation,
      updateMarker,
      clearUserLocations,
      updateRoute,
      fitToRoute
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initializeMap);
    } else {
      initializeMap();
    }

    setTimeout(() => {
      if (!map) initializeMap();
    }, 500);
  </script>
</body>
</html>`;
  };

  const handleWebViewMessage = (event) => {
    try {
      let rawData = event.nativeEvent?.data || event.data;
      if (typeof rawData === 'string') {
        try {
          rawData = JSON.parse(rawData);
        } catch (e) {
          return;
        }
      }
      if (!rawData || typeof rawData !== 'object') return;

      switch (rawData.type) {
        case 'mapReady':
          setIsMapReady(true);
          break;
          
        case 'mapClick':
          if (onMapPress) {
            onMapPress({
              latitude: rawData.latitude,
              longitude: rawData.longitude
            });
          }
          break;
          
        case 'markerDragEnd':
          if (onMarkerDragEnd) {
            onMarkerDragEnd({
              latitude: rawData.latitude,
              longitude: rawData.longitude
            });
          }
          break;
      }
    } catch (error) {
      console.error('Error parsing LeafletMap WebView message:', error);
    }
  };

  useImperativeHandle(ref, () => ({
    centerOnLocation: (location, zoom = 15) => {
      if (!location) return;
      sendMessageToWebView({
        type: 'CENTER_ON_LOCATION',
        latitude: location.latitude,
        longitude: location.longitude,
        zoom: zoom
      });
      sendMessageToWebView(`
        if (window.mapFunctions && window.mapFunctions.centerOnLocation) {
          window.mapFunctions.centerOnLocation(${location.latitude}, ${location.longitude}, ${zoom});
        }
      `);
    },
    
    clearMap: () => {
      sendMessageToWebView({ type: 'CLEAR_USER_LOCATIONS' });
      sendMessageToWebView(`
        if (window.mapFunctions && window.mapFunctions.clearUserLocations) {
          window.mapFunctions.clearUserLocations();
        }
      `);
    },
    
    fitToRoute: () => {
      sendMessageToWebView({ type: 'FIT_TO_ROUTE' });
      sendMessageToWebView(`
        if (window.mapFunctions && window.mapFunctions.fitToRoute) {
          window.mapFunctions.fitToRoute();
        }
      `);
    },

    updateRoute: (locations) => {
      sendMessageToWebView({ type: 'UPDATE_ROUTE', locations });
      sendMessageToWebView(`
        if (window.mapFunctions && window.mapFunctions.updateRoute) {
          window.mapFunctions.updateRoute(${JSON.stringify(locations)});
        }
      `);
    },

    updateMarker: (location) => {
      if (!location) return;
      sendMessageToWebView({
        type: 'UPDATE_MARKER',
        latitude: location.latitude,
        longitude: location.longitude
      });
      sendMessageToWebView(`
        if (window.mapFunctions && window.mapFunctions.updateMarker) {
          window.mapFunctions.updateMarker(${location.latitude}, ${location.longitude});
        }
      `);
    }
  }));

  return (
    <View style={styles.container}>
      <UniversalWebView
        ref={webViewRef}
        source={{ html: createMapHtml(initialMapData) }}
        style={styles.webview}
        onMessage={handleWebViewMessage}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        startInLoadingState={true}
        scalesPageToFit={true}
        bounces={false}
        scrollEnabled={false}
        mixedContentMode="compatibility"
        onLoadEnd={() => setIsMapReady(true)}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  webview: {
    flex: 1,
  },
});

export default SimpleLeafletMap;