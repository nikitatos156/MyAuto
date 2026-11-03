package __PKG__;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;

/** Виджет: строки готовит приложение (ТО, ОСАГО, штрафы), виджет только показывает их. */
public class MyAutoWidget extends AppWidgetProvider {
    static final String PREFS = "myauto_widget";
    static final String KEY = "data";
    private static final int[] LINES = {
        R.id.myauto_w_l1, R.id.myauto_w_l2, R.id.myauto_w_l3, R.id.myauto_w_l4, R.id.myauto_w_l5, R.id.myauto_w_l6, R.id.myauto_w_l7,
    };

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) render(context, manager, id);
    }

    static void updateAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, MyAutoWidget.class));
        for (int id : ids) render(context, manager, id);
    }

    private static int color(String tone) {
        switch (tone) {
            case "danger":
                return Color.parseColor("#FF6B6B");
            case "warn":
                return Color.parseColor("#FFB547");
            case "muted":
                return Color.parseColor("#9096A1");
            default:
                return Color.parseColor("#ECEDEF");
        }
    }

    static void render(Context context, AppWidgetManager manager, int id) {
        RemoteViews v = new RemoteViews(context.getPackageName(), R.layout.myauto_widget);
        String json = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null);
        int shown = 0;
        try {
            if (json != null) {
                JSONObject o = new JSONObject(json);
                v.setTextViewText(R.id.myauto_w_updated, "обновлено " + o.optString("updated", ""));
                JSONArray lines = o.optJSONArray("lines");
                for (int i = 0; lines != null && i < lines.length() && i < LINES.length; i++) {
                    JSONObject l = lines.getJSONObject(i);
                    v.setTextViewText(LINES[i], l.optString("text", ""));
                    v.setTextColor(LINES[i], color(l.optString("tone", "ok")));
                    v.setViewVisibility(LINES[i], View.VISIBLE);
                    shown++;
                }
            }
        } catch (Exception ignored) {
            shown = 0;
        }
        for (int i = shown; i < LINES.length; i++) v.setViewVisibility(LINES[i], View.GONE);
        if (shown == 0) {
            v.setTextViewText(LINES[0], "Откройте приложение — здесь появятся ТО, ОСАГО и штрафы");
            v.setTextColor(LINES[0], color("muted"));
            v.setViewVisibility(LINES[0], View.VISIBLE);
            v.setTextViewText(R.id.myauto_w_updated, "");
        }

        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        Intent open = new Intent(context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        v.setOnClickPendingIntent(R.id.myauto_w_root, PendingIntent.getActivity(context, 0, open, flags));
        Intent docs = new Intent(Intent.ACTION_VIEW, Uri.parse("myauto://show"), context, MainActivity.class);
        docs.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        v.setOnClickPendingIntent(R.id.myauto_w_docs, PendingIntent.getActivity(context, 1, docs, flags));
        manager.updateAppWidget(id, v);
    }
}
