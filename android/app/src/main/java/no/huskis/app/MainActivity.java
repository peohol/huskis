package no.huskis.app;

import android.os.Bundle;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

/**
 * Huskis-skallet. Alt UI ligger i web-laget; det eneste native her er systemets
 * tilbakeknapp.
 *
 * <p>Capacitor gjør ingenting med den selv: {@code @capacitor/android} har ingen
 * back-håndtering, så {@link BridgeActivity} arver AppCompats standard og
 * FØRSTE trykk forlater appen — også med en modal, en popover eller en
 * objektmeny åpen.
 *
 * <p>Her spørres web-laget først. {@code window.__huskisSystemBack()} lukker
 * øverste lag og svarer true når Huskis tok trykket; svarer det false, sendes
 * trykket videre til OS med den oppførselen plattformen selv har. Web-laget
 * setter broen opp kun i native runtime — i en nettleser finnes den ikke
 * (docs/mobilapp-plan.md, arkitekturregel 2).
 *
 * <p>Kallet er asynkront (WebView-en svarer på UI-tråden etterpå), derfor
 * mønsteret «skru av callbacken, be dispatcheren om trykket på nytt, skru den
 * på igjen» i stedet for {@code finish()}: da er det fortsatt OS som avgjør hva
 * et tilbaketrykk på rot-aktiviteten betyr.
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        final OnBackPressedCallback callback = new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                final OnBackPressedCallback self = this;
                bridge.eval(
                    "!!(window.__huskisSystemBack && window.__huskisSystemBack())",
                    value -> {
                        if ("true".equals(value)) return; // Huskis lukket et lag
                        self.setEnabled(false);
                        getOnBackPressedDispatcher().onBackPressed();
                        self.setEnabled(true);
                    }
                );
            }
        };
        getOnBackPressedDispatcher().addCallback(this, callback);
    }
}
