import React, { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, ActivityIndicator, Text } from 'react-native';
import UniversalWebView from '../components/UniversalWebView';
import { supabase } from '../services/supabase';

export default function ProductMapScreen({ route }) {
  const { customerId } = route?.params || {};
  const [productLocations, setProductLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const webViewRef = useRef(null);

  useEffect(() => {
    async function fetchProductLocations() {
      try {
        setLoading(true);
        let query = supabase
          .from('products')
          .select(
            `
            id,
            product_name,
            customers ( id, latitude, longitude )
          `
          );

        if (customerId) {
          query = query.eq('customer_id', customerId);
        }

        const { data, error } = await query;

        if (error) throw error;

        const locations = data
          .filter(p => p.customers && p.customers.latitude && p.customers.longitude)
          .map(p => ({
            id: p.id,
            name: p.product_name,
            latitude: p.customers.latitude,
            longitude: p.customers.longitude,
          }));

        setProductLocations(locations);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    if (customerId) {
      fetchProductLocations();
    }
  }, [customerId]);

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
        <title>Product Map</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.7.1/dist/leaflet.css" />
        <script src="https://unpkg.com/leaflet@1.7.1/dist/leaflet.js"></script>
        <style>
            body { margin: 0; padding: 0; }
            #mapid { width: 100vw; height: 100vh; }
        </style>
    </head>
    <body>
        <div id="mapid"></div>
        <script>
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

            var productLocations = ${JSON.stringify(productLocations)};

            if (productLocations.length > 0) {
                var bounds = L.latLngBounds(productLocations.map(p => [p.latitude, p.longitude]));
                map.fitBounds(bounds.pad(0.1));

                productLocations.forEach(function(location) {
                    L.marker([location.latitude, location.longitude])
                        .addTo(map)
                        .bindPopup('<b>' + location.name + '</b>');
                });
            }
        </script>
    </body>
    </html>
  `;

  return (
    <View style={styles.container}>
        <UniversalWebView
            ref={webViewRef}
            originWhitelist={['*']}
            source={{ html: htmlContent, baseUrl: '' }}
            style={styles.webview}
            javaScriptEnabled={true}
            domStorageEnabled={true}
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
