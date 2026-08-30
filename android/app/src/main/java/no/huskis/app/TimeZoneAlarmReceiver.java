package no.huskis.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.UserManager;

import com.capacitorjs.plugins.localnotifications.LocalNotification;
import com.capacitorjs.plugins.localnotifications.LocalNotificationManager;
import com.capacitorjs.plugins.localnotifications.NotificationStorage;
import com.getcapacitor.CapConfig;
import com.getcapacitor.JSObject;

import java.util.ArrayList;
import java.util.List;
import java.util.TimeZone;

/**
 * Flytter Huskis' allerede planlagte lokale varsler når telefonen bytter
 * tidssone — også når appen er HELT lukket.
 *
 * <p>Uten denne står et varsel som ble planlagt kl. 09:00 i Oslo fast på det
 * absolutte tidspunktet 09:00-i-Oslo var, og ringer f.eks. kl. 17:00 etter en
 * reise til Tokyo — helt til Huskis åpnes og synker på nytt. Huskis' semantikk
 * er den motsatte: en terskel uttrykt i lokal veggtid skal følge telefonens
 * klokke.</p>
 *
 * <p><b>Hvorfor en receiver og ikke noe større.</b>
 * {@code ACTION_TIMEZONE_CHANGED} er én av de få implisitte kringkastingene
 * Android eksplisitt UNNTAR fra bakgrunnsbegrensningene i 8.0, og
 * begrunnelsen i Androids egen dokumentasjon er nøyaktig vårt tilfelle:
 * «Clock apps might need to receive these broadcasts to update alarms when the
 * time, timezone, or alarms change.» Systemet starter altså prosessen vår for
 * å levere den, uten at WebView-en, JS-motoren eller synken kjøres.</p>
 *
 * <p><b>Hvorfor pluginen ikke gjør det selv.</b> Den planlegger med
 * {@code AlarmManager.RTC_WAKEUP} og et absolutt millisekund, og manifestet
 * dens registrerer bare oppstartssignalene ({@code BOOT_COMPLETED} og
 * slektningene). Vi hverken forker eller kopierer den: vi bruker dens egen
 * lagring og dens egen planlegger, på samme måte som dens egen
 * {@code LocalNotificationRestoreReceiver} gjør etter en omstart.</p>
 *
 * <p><b>Én varselmodell.</b> Regelen for HVA som skal varsles bor i
 * generatoren i {@code app.js} og ingen andre steder. Det eneste som er lagt
 * til på den native siden er ett felt i alarmens {@code extra}: veggtiden den
 * var ment å ha ({@code notifWallClock()}). {@link HuskisWallClock} regner den
 * om — ingen terskler, ingen frister, ingen tilstand.</p>
 *
 * <p><b>Omstart.</b> Den korrigerte tiden skrives TILBAKE til pluginens egen
 * lagring før alarmen settes på nytt. Uten det ville pluginens
 * oppstartsgjenoppretting lest den GAMLE tiden etter en reboot og satt
 * alarmen tilbake der den var.</p>
 *
 * <p><b>Ingen ny tillatelse.</b> {@code TIMEZONE_CHANGED} krever ingen, og
 * alarmene settes fortsatt gjennom pluginen med {@code isExactNotification:
 * false} — SCHEDULE_EXACT_ALARM er like trukket tilbake som før.</p>
 */
public class TimeZoneAlarmReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !Intent.ACTION_TIMEZONE_CHANGED.equals(intent.getAction())) return;

        // Lagringen ligger i den krypterte brukerlagringen. Før første opplåsing
        // etter en omstart finnes den ikke — da gjør pluginens egen
        // oppstartsgjenoppretting jobben uansett.
        UserManager um = context.getSystemService(UserManager.class);
        if (um == null || !um.isUserUnlocked()) return;

        TimeZone tz = nySone(intent);
        long now = System.currentTimeMillis();

        NotificationStorage storage = new NotificationStorage(context);
        List<LocalNotification> endret = new ArrayList<>();
        for (String id : storage.getSavedNotificationIds()) {
            JSObject lagret = storage.getSavedNotificationAsJSObject(id);
            if (lagret == null) continue;
            String oppdatert = HuskisWallClock.retimeStoredNotification(lagret.toString(), tz, now);
            if (oppdatert == null) continue;            // ikke vår, avlyst, alt ringt, eller uendret
            try {
                endret.add(LocalNotification.Companion.buildNotificationFromJSObject(new JSObject(oppdatert)));
            } catch (Exception e) {
                // En rad vi ikke klarer å lese skal ikke stoppe de andre.
            }
        }
        if (endret.isEmpty()) return;

        // REKKEFØLGEN betyr noe: lagringen først, så alarmen. Skjer det en
        // omstart mellom de to, gjenoppretter pluginen fra den KORRIGERTE tiden.
        storage.appendNotifications(endret);
        new LocalNotificationManager(storage, null, context, CapConfig.loadDefault(context))
                .schedule(null, endret);
    }

    /**
     * Sonen å regne i. Kringkastingen bærer den nye sone-ID-en selv, og den er
     * å foretrekke: {@code TimeZone.getDefault()} er bufret i prosessen, og
     * hvem som tømmer den bufferen først — systemet eller oss — er ikke noe vi
     * kan bestemme. Er ID-en ukjent, faller vi tilbake på prosessens egen.
     */
    private static TimeZone nySone(Intent intent) {
        String id = intent.getStringExtra("time-zone");
        if (id != null && !id.isEmpty()) {
            TimeZone fra = TimeZone.getTimeZone(id);
            // getTimeZone() svarer GMT på alt den ikke kjenner — så den må
            // bekrefte sin egen ID før vi stoler på den.
            if (id.equals(fra.getID())) return fra;
        }
        return TimeZone.getDefault();
    }
}
