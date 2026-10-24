package dev.paisapulse.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Telephony;
import android.telephony.SmsMessage;
import java.util.Locale;

/**
 * Wake only while a widget is installed, and only for business senders (not phone
 * numbers). Which senders are banks is decided by the app's config-driven parser.
 */
public final class WidgetSmsReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c,Intent intent) {
        if(!Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction()) || !DripWidgetProvider.hasWidgets(c))return;
        for(SmsMessage sms:Telephony.Sms.Intents.getMessagesFromIntent(intent)) {
            String sender=sms.getOriginatingAddress();
            if(sender==null)continue;
            sender=sender.toUpperCase(Locale.ROOT);
            if(sender.matches(".*[A-Z]{3}.*") && !sender.matches("^\\+?[\\d\\s-]+$")) {
                WidgetSyncService.schedule(c);return;
            }
        }
    }
}
