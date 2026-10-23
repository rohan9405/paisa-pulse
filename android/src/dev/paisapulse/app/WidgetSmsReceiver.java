package dev.paisapulse.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.provider.Telephony;
import android.telephony.SmsMessage;
import java.util.Locale;

/** Wake only for supported bank senders and only while a widget is installed. */
public final class WidgetSmsReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c,Intent intent) {
        if(!Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction()) || !DripWidgetProvider.hasWidgets(c))return;
        for(SmsMessage sms:Telephony.Sms.Intents.getMessagesFromIntent(intent)) {
            String sender=sms.getOriginatingAddress();
            if(sender==null)continue;
            sender=sender.toUpperCase(Locale.ROOT);
            if(sender.matches(".*(?:HDFC[A-Z]*|ICICI[A-Z]*|ICICBK|ICIOTP|SBI[A-Z]*|ATMSBI|CBSSBI|SBMSBI|CRDSBI|AXIS[A-Z]*|KOTAK[A-Z]*)(?:-[A-Z])?")) {
                WidgetSyncService.schedule(c);return;
            }
        }
    }
}
