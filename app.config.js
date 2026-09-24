import 'dotenv/config';

export default {
  "expo": {
    "name": "Needs Tracker",
    "slug": "needs-tracker",
    "owner": "narasimhaexpo6s-team", // 👈 Added your exact organization account name here
    "scheme": "needstracking",
    "version": "1.0.0",
    "orientation": "portrait",
    "userInterfaceStyle": "light",
    "icon": "./assets/icon.png",
    "splash": {
      "image": "./assets/icon.png", // Replaced with valid image reference for Expo 53
      "resizeMode": "contain",
      "backgroundColor": "#ffffff"
    },
    "assetBundlePatterns": [
      "**/*"
    ],
    "ios": {
      "supportsTablet": true,
      "infoPlist": {
        "NSLocationWhenInUseUsageDescription": "NeedsTracking needs access to location to track your movements for location history.",
        "NSLocationAlwaysAndWhenInUseUsageDescription": "NeedsTracking needs access to location to track your movements even when the app is in background for continuous tracking.",
        "NSBluetoothAlwaysUsageDescription": "NeedsTracking needs access to Bluetooth to discover and connect to Bluetooth thermal receipt printers.",
        "NSBluetoothPeripheralUsageDescription": "NeedsTracking needs access to Bluetooth to connect to thermal receipt printers.",
        "UIBackgroundModes": [
          "location",
          "background-processing"
        ]
      }
    },
    "android": {
      "usesCleartextTraffic": true,
      "adaptiveIcon": {
        "backgroundColor": "#FFFFFF"
      },
      "googleServicesFile": "./google-services.json",
      "permissions": [
        "android.permission.ACCESS_FINE_LOCATION",
        "android.permission.ACCESS_COARSE_LOCATION",
        "android.permission.ACCESS_BACKGROUND_LOCATION",
        "android.permission.FOREGROUND_SERVICE",
        "android.permission.WAKE_LOCK",
        "android.permission.RECORD_AUDIO",
        "android.permission.INTERNET",
        "android.permission.BLUETOOTH",
        "android.permission.BLUETOOTH_ADMIN",
        "android.permission.BLUETOOTH_CONNECT",
        "android.permission.BLUETOOTH_SCAN"
      ],
      "package": "com.narasimhaexpo.needstrackingmobile",

    },
    "web": {
      "bundler": "metro",
      "favicon": "./assets/icon.png",
      "name": "Needs Tracker",
      "shortName": "NeedsTracker",
      "description": "Real-time delivery tracking, orders, and local marketplace",
      "themeColor": "#007AFF",
      "backgroundColor": "#ffffff",
      "display": "standalone",
      "orientation": "portrait"
    },
    "experiments": {
      "baseUrl": "/needsTracking"
    },
    "plugins": [
      [
        "expo-location",
        {
          "locationAlwaysAndWhenInUsePermission": "Allow NeedsTracking to use your location for tracking purposes.",
          "locationAlwaysPermission": "Allow NeedsTracking to use your location in the background for continuous tracking."
        }
      ],
      [
        "expo-image-picker",
        {
          "photosPermission": "Allow NeedsTracking to access your photos to upload profile images."
        }
      ],
      [
        "expo-notifications",
        {
          "icon": "./assets/icon.png",
          "color": "#ffffff"
        }
      ],
      "expo-web-browser"
    ],
    "updates": {
      "url": "https://u.expo.dev/3ce03f97-e109-4f80-a0ba-b0fa19f6ad0b"
    },
    "runtimeVersion": {
      "policy": "appVersion"
    },
    "sdkVersion": "53.0.0",
    "extra": {
      "ORG_NAME": (typeof process.env.EXPO_PUBLIC_ORG_NAME === 'string' && process.env.EXPO_PUBLIC_ORG_NAME) || (typeof process.env.ORG_NAME === 'string' && process.env.ORG_NAME) || "Store",
      "ADMIN_MOBILE": (typeof process.env.EXPO_PUBLIC_ADMIN_MOBILE === 'string' && process.env.EXPO_PUBLIC_ADMIN_MOBILE) || (typeof process.env.ADMIN_MOBILE === 'string' && process.env.ADMIN_MOBILE) || "9849535153",
      "SUPABASE_URL": (typeof process.env.EXPO_PUBLIC_SUPABASE_URL === 'string' && process.env.EXPO_PUBLIC_SUPABASE_URL) || (typeof process.env.SUPABASE_URL === 'string' && process.env.SUPABASE_URL) || "https://cikxysaxvbixrcwlgzds.supabase.co",
      "SUPABASE_ANON_KEY": (typeof process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY === 'string' && process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY) || (typeof process.env.SUPABASE_ANON_KEY === 'string' && process.env.SUPABASE_ANON_KEY) || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNpa3h5c2F4dmJpeHJjd2xnemRzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2MzA2MjgsImV4cCI6MjEwNDIwNjYyOH0.YIc4KXr055r1D3-mKW1bCn06GNWWK4TXettqhazgpg4",
      "eas": {
        "projectId": "3ce03f97-e109-4f80-a0ba-b0fa19f6ad0b"
      }
    }
  }
};
