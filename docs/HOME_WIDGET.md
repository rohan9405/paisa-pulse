# Home widget

The native Android **drip · Today & month** widget defaults to 4 × 2 cells and supports resizing. Add it from Settings → App → Home widget, or long-press the launcher → Widgets → drip.

- **Left:** today's remaining allowance, including carry-forward, and a water drop that drains as the allowance is spent. The daily denominator includes carried money and adjustments. A deficit shows “Over budget by”; tracking-only mode shows “Spent today” without a budget gauge.
- **Right:** Monday-first month calendar; lime cells are under-budget days, coral cells are over-budget days, and today is highlighted. Future and untracked days are neutral. Tracking-only history is violet. “Month spent” is spending charged against the daily budget, including planned overages, excluding reserved payments and own transfers.
- **Updates:** personal budget changes and SMS sync publish a small snapshot to Android. Android periodically redraws the widget and rolls the date forward in IST using forecast allocations. No background SMS reader or hidden WebView runs. After the snapshot's date, the widget says **Estimate · open to sync**; unobserved days never receive under-budget colours. Android can delay periodic updates to save battery, so rollover isn't an exact-midnight alarm.
- **Privacy:** only derived dates and totals are cached in private app storage, never SMS, merchants, bank balances or payees. Demo data is never published. App lock hides all figures and the calendar even while drip itself is unlocked. Deleting personal data clears the cache. Tapping anywhere opens drip and follows its normal lock flow.
- **Offline:** no internet, new permission, dependency or server. Uses Java `AppWidgetProvider`, `RemoteViews`, and a bitmap drawn locally for consistent drop/calendar rendering on Android 8+.

Sources: `src/lib/widget.ts` builds the snapshot from the existing budget engine; `src/data/useHomeWidget.ts` publishes it; `WidgetBridge.java` caches it; `DripWidgetProvider.java` draws it. Dates beyond the 40-day forecast require opening drip again. The launcher controls actual cell dimensions.
