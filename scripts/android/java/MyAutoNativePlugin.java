package __PKG__;

import android.content.Context;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.Executor;

/** Мост My Auto: данные для виджета на рабочем столе и вход по отпечатку / лицу (BiometricPrompt). */
@CapacitorPlugin(name = "MyAutoNative")
public class MyAutoNativePlugin extends Plugin {
    private static final int AUTHENTICATORS = BiometricManager.Authenticators.BIOMETRIC_WEAK;

    @PluginMethod
    public void updateWidget(PluginCall call) {
        String data = call.getString("data", "{}");
        getContext().getSharedPreferences(MyAutoWidget.PREFS, Context.MODE_PRIVATE).edit().putString(MyAutoWidget.KEY, data).apply();
        MyAutoWidget.updateAll(getContext());
        call.resolve();
    }

    @PluginMethod
    public void biometricAvailable(PluginCall call) {
        int r = BiometricManager.from(getContext()).canAuthenticate(AUTHENTICATORS);
        JSObject ret = new JSObject();
        ret.put("available", r == BiometricManager.BIOMETRIC_SUCCESS);
        ret.put("code", r);
        call.resolve(ret);
    }

    @PluginMethod
    public void biometricAuth(final PluginCall call) {
        final String title = call.getString("title", "My Auto");
        final String subtitle = call.getString("subtitle", "");
        final FragmentActivity activity = getActivity();
        activity.runOnUiThread(() -> {
            try {
                Executor executor = ContextCompat.getMainExecutor(activity);
                BiometricPrompt prompt = new BiometricPrompt(activity, executor, new BiometricPrompt.AuthenticationCallback() {
                    @Override
                    public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                        JSObject ret = new JSObject();
                        ret.put("ok", true);
                        call.resolve(ret);
                    }

                    @Override
                    public void onAuthenticationError(int errorCode, CharSequence errString) {
                        JSObject ret = new JSObject();
                        ret.put("ok", false);
                        ret.put("code", errorCode);
                        ret.put("error", String.valueOf(errString));
                        call.resolve(ret);
                    }
                });
                BiometricPrompt.PromptInfo.Builder info = new BiometricPrompt.PromptInfo.Builder()
                    .setTitle(title)
                    .setAllowedAuthenticators(AUTHENTICATORS)
                    .setNegativeButtonText("Ввести PIN-код");
                if (subtitle != null && !subtitle.isEmpty()) info.setSubtitle(subtitle);
                prompt.authenticate(info.build());
            } catch (Exception e) {
                call.reject(String.valueOf(e.getMessage()));
            }
        });
    }
}
