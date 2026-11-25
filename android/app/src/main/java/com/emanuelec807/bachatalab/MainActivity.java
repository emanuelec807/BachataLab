package com.emanuelec807.bachatalab;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SeparatorPlugin.class); // native stem separation (ONNX Runtime)
        super.onCreate(savedInstanceState);
    }
}
