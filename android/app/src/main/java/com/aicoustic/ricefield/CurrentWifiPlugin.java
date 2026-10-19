package com.aicoustic.ricefield;

import android.Manifest;
import android.content.Context;
import android.location.LocationManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.firebase.messaging.FirebaseMessaging;

@CapacitorPlugin(
    name = "CurrentWifi",
    permissions = {
        @Permission(alias = "nearbyWifi", strings = { Manifest.permission.NEARBY_WIFI_DEVICES }),
        @Permission(alias = "fineLocation", strings = { Manifest.permission.ACCESS_FINE_LOCATION })
    }
)
public class CurrentWifiPlugin extends Plugin {
    private static final String PEST_ALERT_TOPIC = "aicoustic-pest-alerts";

    @PluginMethod
    public void subscribePestAlerts(PluginCall call) {
        updatePestAlertTopic(call, true);
    }

    @PluginMethod
    public void unsubscribePestAlerts(PluginCall call) {
        updatePestAlertTopic(call, false);
    }

    private void updatePestAlertTopic(PluginCall call, boolean subscribe) {
        try {
            var operation = subscribe
                ? FirebaseMessaging.getInstance().subscribeToTopic(PEST_ALERT_TOPIC)
                : FirebaseMessaging.getInstance().unsubscribeFromTopic(PEST_ALERT_TOPIC);
            operation.addOnCompleteListener(task -> {
                if (task.isSuccessful()) {
                    call.resolve(new JSObject());
                } else {
                    call.reject("Could not update device pest-alert subscription.", task.getException());
                }
            });
        } catch (Exception error) {
            call.reject("Could not update device pest-alert subscription.", error);
        }
    }

    private String[] requiredAliases() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            ? new String[] { "nearbyWifi", "fineLocation" }
            : new String[] { "fineLocation" };
    }

    @PluginMethod
    public void getCurrentNetwork(PluginCall call) {
        if (!hasRequiredPermissions()) {
            requestPermissionForAliases(requiredAliases(), call, "wifiPermissionCallback");
            return;
        }
        resolveCurrentNetwork(call);
    }

    @Override
    public boolean hasRequiredPermissions() {
        for (String alias : requiredAliases()) {
            if (getPermissionState(alias) != PermissionState.GRANTED) return false;
        }
        return true;
    }

    @PermissionCallback
    private void wifiPermissionCallback(PluginCall call) {
        if (!hasRequiredPermissions()) {
            call.reject("Allow Location and Nearby devices permissions so Android can show the connected Wi-Fi name.");
            return;
        }
        resolveCurrentNetwork(call);
    }

    private void resolveCurrentNetwork(PluginCall call) {
        try {
            Context context = getContext().getApplicationContext();
            WifiManager wifiManager = (WifiManager) context.getSystemService(Context.WIFI_SERVICE);
            boolean enabled = wifiManager != null && wifiManager.isWifiEnabled();
            ConnectivityManager connectivity = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
            NetworkCapabilities wifiCapabilities = null;
            if (connectivity != null) {
                for (Network network : connectivity.getAllNetworks()) {
                    NetworkCapabilities candidate = connectivity.getNetworkCapabilities(network);
                    if (candidate != null && candidate.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) {
                        wifiCapabilities = candidate;
                        break;
                    }
                }
            }
            boolean connected = wifiCapabilities != null;
            WifiInfo info = null;
            if (wifiCapabilities != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                && wifiCapabilities.getTransportInfo() instanceof WifiInfo) {
                info = (WifiInfo) wifiCapabilities.getTransportInfo();
            }
            if (info == null && wifiManager != null && connected) info = wifiManager.getConnectionInfo();

            String ssid = null;
            if (info != null) {
                String value = info.getSSID();
                if (value != null && !WifiManager.UNKNOWN_SSID.equals(value)) {
                    ssid = value.replaceAll("^\"|\"$", "");
                }
            }
            LocationManager location = (LocationManager) context.getSystemService(Context.LOCATION_SERVICE);
            boolean locationEnabled = location != null && (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? location.isLocationEnabled()
                : location.isProviderEnabled(LocationManager.NETWORK_PROVIDER));
            JSObject result = new JSObject();
            result.put("enabled", enabled);
            result.put("connected", connected);
            result.put("locationEnabled", locationEnabled);
            result.put("ssid", ssid);
            call.resolve(result);
        } catch (SecurityException error) {
            call.reject("Android permission is required to read the current Wi-Fi name.", error);
        } catch (Exception error) {
            call.reject("Could not read the current Wi-Fi connection.", error);
        }
    }
}
