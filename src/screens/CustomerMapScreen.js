import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  ActivityIndicator,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  Alert,
  Linking,
  Platform,
  Modal,
  Image,
  ScrollView,
  Button,
} from 'react-native';
import UniversalWebView from '../components/UniversalWebView';
import { supabase, getCustomerDocuments } from '../services/supabase'; // Import getCustomerDocuments
import Icon from 'react-native-vector-icons/FontAwesome';
import * as Location from 'expo-location';
import ImageViewer from 'react-native-image-zoom-viewer'; // Import ImageViewer
import { useCart } from '../context/CartContext';
import OrderIconComponent from '../components/OrderIconComponent';
import CartIconComponent from '../components/CartIconComponent';
import ProfileIconComponent from '../components/ProfileIconComponent';
import ProductManageIconComponent from '../components/ProductManageIconComponent';


function AreaSearchBar({ onAreaSelected, onClear }) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const debounceTimeout = useRef(null);

  const fetchSuggestions = async (text) => {
    if (!text) {
      setSuggestions([]);
      return;
    }
    setLoading(true);
    try {
        const { data, error } = await supabase
            .from('area_master')
            .select('id, area_name, latitude, longitude')
            .ilike('area_name', `%${text}%`)
            .limit(5);

        if (error) throw error;
        setSuggestions(data);
    } catch (e) {
      setSuggestions([]);
    }
    setLoading(false);
  };

  const onChangeText = (text) => {
    setQuery(text);
    if (debounceTimeout.current) clearTimeout(debounceTimeout.current);
    debounceTimeout.current = setTimeout(() => fetchSuggestions(text), 400);
  };

  const onSuggestionPress = (item) => {
    setQuery(item.area_name);
    setSuggestions([]);
    onAreaSelected(item);
  };

  return (
    <View style={styles.searchContainer}>
      <View style={{ flexDirection: 'row' }}>
        <TextInput
          value={query}
          onChangeText={onChangeText}
          placeholder="Search Area"
          style={styles.searchInput}
        />
        {loading && <ActivityIndicator size="small" style={{ marginLeft: 8 }} />}
        <TouchableOpacity onPress={() => { setQuery(''); onClear(); }} style={{ padding: 8 }}><Text>Clear</Text></TouchableOpacity>
      </View>
      {suggestions.length > 0 && (
        <FlatList
          data={suggestions}
          keyExtractor={(item) => item.id.toString()}
          style={styles.suggestionList}
          renderItem={({ item }) => (
            <TouchableOpacity onPress={() => onSuggestionPress(item)} style={styles.suggestionItem}>
              <Text>{item.area_name}</Text>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

function CustomerSearchBar({ onCustomerSelected, areaId }) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const debounceTimeout = useRef(null);

  const fetchSuggestions = async (text) => {
    if (!text) {
      setSuggestions([]);
      return;
    }
    setLoading(true);
    try {
        let queryBuilder = supabase
            .from('customers')
            .select('id, name, mobile, book_no, email, latitude, longitude')
            .or(`name.ilike.%${text}%,mobile.ilike.%${text}%,book_no.ilike.%${text}%,email.ilike.%${text}%`)
            .limit(5);

        if (areaId) {
            queryBuilder = queryBuilder.eq('area_id', areaId);
        }

        const { data, error } = await queryBuilder;

        if (error) throw error;
        setSuggestions(data);
    } catch (e) {
      setSuggestions([]);
    }
    setLoading(false);
  };

  const onChangeText = (text) => {
    setQuery(text);
    if (debounceTimeout.current) clearTimeout(debounceTimeout.current);
    debounceTimeout.current = setTimeout(() => fetchSuggestions(text), 400);
  };

  const onSuggestionPress = (item) => {
    setQuery(item.name);
    setSuggestions([]);
    onCustomerSelected(item);
  };

  return (
    <View style={[styles.searchContainer, { top: 70 }]}>
      <View style={{ flexDirection: 'row' }}>
        <TextInput
          value={query}
          onChangeText={onChangeText}
          placeholder="Search Customer (Name, Mobile, Card, Email)"
          style={styles.searchInput}
        />
        {loading && <ActivityIndicator size="small" style={{ marginLeft: 8 }} />}
      </View>
      {suggestions.length > 0 && (
        <FlatList
          data={suggestions}
          keyExtractor={(item) => item.id.toString()}
          style={styles.suggestionList}
          renderItem={({ item }) => (
            <TouchableOpacity onPress={() => onSuggestionPress(item)} style={styles.suggestionItem}>
              <Text>{item.name} - {item.mobile}</Text>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

import { useNavigation } from '@react-navigation/native'; // Add this import

export default function CustomerMapScreen({ route }) { // Remove navigation from props
  const navigation = useNavigation(); // Get navigation from hook
  const { user, role } = useCart();
  const { customerId } = route?.params || {}; // Get customerId from route params
  const [customerLocations, setCustomerLocations] = useState([]);
  const [allAreas, setAllAreas] = useState([]);
  const [userLocation, setUserLocation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedArea, setSelectedArea] = useState(null);
  const webViewRef = useRef(null);
  const [isCustomerImageModalVisible, setIsCustomerImageModalVisible] = useState(false); // New state
  const [currentCustomerImages, setCurrentCustomerImages] = useState([]); // New state
  const [isImageViewerVisible, setIsImageViewerVisible] = useState(false); // New state for full screen image viewer
  const [viewerImages, setViewerImages] = useState([]); // New state for images in viewer
  const [isLoginMenuVisible, setIsLoginMenuVisible] = useState(false);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        let { status } = await Location.requestForegroundPermissionsAsync();
        
        if (status !== 'granted') {
          console.warn('Location permission denied');
          // Default location if permission denied
          setUserLocation({ latitude: 28.6139, longitude: 77.2090 });
        } else {
          try {
            let location = await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.Balanced,
              timeout: 5000,
            });
            setUserLocation(location.coords);
          } catch (locationError) {
            console.warn('Location query failed:', locationError.message);
            // Fallback to default
            setUserLocation({ latitude: 28.6139, longitude: 77.2090 });
          }
        }
        // Fetch only if customerId is provided
        if (customerId) {
          await fetchCustomerLocation(customerId);
        } else {
          await fetchAllLocations();
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [customerId]);

  async function fetchAllLocations() {
    try {
      const { data, error: fetchError } = await supabase
        .from('profiles')
        .select('id, full_name, role, latitude, longitude, avatar_url, media_urls')
        .not('latitude', 'is', null)
        .not('longitude', 'is', null);

      if (!fetchError && data && data.length > 0) {
        setCustomerLocations(
          data.map((p) => {
            let mediaList = [];
            if (p.media_urls) {
              try {
                mediaList = typeof p.media_urls === 'string' ? JSON.parse(p.media_urls) : p.media_urls;
              } catch (_) {
                mediaList = [];
              }
            }
            const firstPhoto =
              (mediaList && mediaList.find((m) => m.type === 'image')?.uri) ||
              p.avatar_url ||
              null;

            return {
              id: p.id,
              name: p.full_name || 'User Location',
              latitude: p.latitude,
              longitude: p.longitude,
              firstPhoto: firstPhoto,
              role: p.role || 'user',
            };
          })
        );
      }
    } catch (err) {
      console.warn('Error fetching all locations in CustomerMapScreen:', err);
    }
  }

  async function fetchCustomerLocation(id) {
      if (!id) return;
      try {
        const { data, error: fetchError } = await supabase
          .from('profiles')
          .select('latitude, longitude, full_name, avatar_url, media_urls')
          .eq('id', id)
          .single();

        if (fetchError) {
          console.error('Supabase Error fetching customer location:', fetchError);
          throw fetchError;
        }

        if (data && data.latitude && data.longitude) {
          let mediaList = [];
          if (data.media_urls) {
            try {
              mediaList = typeof data.media_urls === 'string' ? JSON.parse(data.media_urls) : data.media_urls;
            } catch (_) {
              mediaList = [];
            }
          }
          const firstPhoto =
            (mediaList && mediaList.find((m) => m.type === 'image')?.uri) ||
            data.avatar_url ||
            null;

          setCustomerLocations([{
            latitude: data.latitude,
            longitude: data.longitude,
            id: id,
            name: data.full_name || 'Customer',
            firstPhoto: firstPhoto,
          }]);
        } else {
          Alert.alert('Location Not Found', 'Customer location not available.');
          setCustomerLocations([]);
        }
      } catch (err) {
        console.error('Error fetching customer location:', err);
        setError(err.message);
      }
  }

  const onMapMessage = async (event) => {
    try {
      const data = typeof event.nativeEvent?.data === 'string' ? JSON.parse(event.nativeEvent.data) : event.nativeEvent?.data;
      // Handle map messages if needed
    } catch (_) {}
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#0000ff" />
        <Text>Loading map data...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Error: {error}</Text>
      </View>
    );
  }

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Customer Map</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.7.1/dist/leaflet.css" />
        <script src="https://unpkg.com/leaflet@1.7.1/dist/leaflet.js"></script>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css" />
        <style>
            body { margin: 0; padding: 0; }
            #mapid { width: 100vw; height: 100vh; background-color: #f0f0f0; }
            .seller-icon-wrapper {
                background: transparent;
                border: none;
            }
            .seller-custom-pin {
                position: relative;
                display: flex;
                flex-direction: column;
                align-items: center;
                cursor: pointer;
                filter: drop-shadow(0 4px 10px rgba(0,0,0,0.3));
                transition: transform 0.2s ease;
            }
            .seller-custom-pin:hover {
                transform: scale(1.15);
            }
            .seller-pin-bubble {
                width: 44px;
                height: 44px;
                border-radius: 50%;
                background: linear-gradient(135deg, #007AFF 0%, #0056b3 100%);
                border: 2.5px solid #FFFFFF;
                overflow: hidden;
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 2px 8px rgba(0,122,255,0.4);
            }
            .seller-pin-img {
                width: 100%;
                height: 100%;
                object-fit: cover;
                display: block;
            }
            .seller-pin-bubble i {
                color: #FFFFFF;
                font-size: 18px;
            }
            .seller-pin-tail {
                width: 0;
                height: 0;
                border-left: 6px solid transparent;
                border-right: 6px solid transparent;
                border-top: 8px solid #007AFF;
                margin-top: -2px;
            }
            .custom-popup .leaflet-popup-content-wrapper {
                border-radius: 14px;
                padding: 0px;
                box-shadow: 0 8px 24px rgba(15,23,42,0.2);
                overflow: hidden;
            }
            .custom-popup .leaflet-popup-content {
                margin: 0;
                padding: 10px 14px;
            }
            .popup-hero-wrap {
                width: 100%;
                height: 100px;
                overflow: hidden;
                background-color: #0F172A;
                margin: -10px -14px 8px -14px;
                width: calc(100% + 28px);
            }
            .popup-hero-img {
                width: 100%;
                height: 100%;
                object-fit: cover;
            }
        </style>
    </head>
    <body>
        <div id="mapid"></div>
        <script>
            function handlePinImgError(img) {
                if (!img) return;
                img.style.display = 'none';
                if (img.nextElementSibling) {
                    img.nextElementSibling.style.display = 'flex';
                }
            }

            var southWest = L.latLng(-85, -180);
            var northEast = L.latLng(85, 180);
            var worldBounds = L.latLngBounds(southWest, northEast);

            var map = L.map('mapid', {
                minZoom: 3,
                maxZoom: 19,
                maxBounds: worldBounds,
                maxBoundsViscosity: 1.0,
                worldCopyJump: false
            }).setView([20.5937, 78.9629], 5);

            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
                maxZoom: 19,
                minZoom: 3,
                noWrap: true,
                bounds: worldBounds
            }).addTo(map);

            var customerLocations = ${JSON.stringify(customerLocations.map(loc => ({
                latitude: loc.latitude,
                longitude: loc.longitude,
                id: loc.id,
                name: loc.name || 'Location',
                firstPhoto: loc.firstPhoto || null,
            })))};

            if (customerLocations.length > 0) {
                var bounds = [];
                customerLocations.forEach(function(loc) {
                    bounds.push([loc.latitude, loc.longitude]);

                    var markerHtml = '';
                    if (loc.firstPhoto) {
                        markerHtml =
                            '<div class="seller-custom-pin">' +
                                '<div class="seller-pin-bubble">' +
                                    '<img src="' + loc.firstPhoto + '" class="seller-pin-img" onerror="handlePinImgError(this)" />' +
                                    '<div style="display:none; color:white; align-items:center; justify-content:center; width:100%; height:100%;"><i class="fas fa-user"></i></div>' +
                                '</div>' +
                                '<div class="seller-pin-tail"></div>' +
                            '</div>';
                    } else {
                        markerHtml =
                            '<div class="seller-custom-pin">' +
                                '<div class="seller-pin-bubble">' +
                                    '<i class="fas fa-map-marker-alt"></i>' +
                                '</div>' +
                                '<div class="seller-pin-tail"></div>' +
                            '</div>';
                    }

                    var customIcon = L.divIcon({
                        className: 'seller-icon-wrapper',
                        html: markerHtml,
                        iconSize: [44, 52],
                        iconAnchor: [22, 52],
                        popupAnchor: [0, -52]
                    });

                    var popupHtml = '';
                    if (loc.firstPhoto) {
                        popupHtml += '<div class="popup-hero-wrap"><img src="' + loc.firstPhoto + '" class="popup-hero-img" /></div>';
                    }
                    popupHtml += '<h4 style="margin:0 0 4px 0; font-size:15px; color:#0F172A;">' + loc.name + '</h4>';

                    L.marker([loc.latitude, loc.longitude], { icon: customIcon })
                        .addTo(map)
                        .bindPopup(popupHtml, { className: 'custom-popup' });
                });
                if (bounds.length === 1) {
                    map.setView(bounds[0], 13);
                } else if (bounds.length > 1) {
                    map.fitBounds(bounds, { padding: [30, 30] });
                }
            } else {
                map.setView([20.5937, 78.9629], 5);
            }

            try {
                if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
                    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'webviewLoaded' }));
                }
            } catch (_) {}
        </script>
    </body>
    </html>
  `;

  return (
    <View style={styles.container}>
        <UniversalWebView
            ref={webViewRef}
            originWhitelist={['*']}
            source={{ html: htmlContent }}
            style={styles.webview}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            onMessage={onMapMessage}
        />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  webview: {
    flex: 1,
  },
  errorText: {
    color: 'red',
    textAlign: 'center',
    marginTop: 20,
  },
});
