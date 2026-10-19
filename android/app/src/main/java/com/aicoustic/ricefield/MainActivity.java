package com.aicoustic.ricefield;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(CurrentWifiPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
