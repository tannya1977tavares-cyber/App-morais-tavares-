package br.com.moraistavares.orcamento;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Comprovantes compartilhados pro app (do WhatsApp, do banco, da galeria). */
@CapacitorPlugin(name = "Recebidos")
public class RecebidosPlugin extends Plugin {
    private static final List<JSObject> fila = new ArrayList<>();

    /** Chamado pela MainActivity quando chega um "Compartilhar" de imagem ou PDF. */
    public static boolean guardar(Context ctx, Intent i) {
        if (i == null) return false;
        String acao = i.getAction();
        List<Uri> uris = new ArrayList<>();
        try {
            if (Intent.ACTION_SEND.equals(acao)) {
                Uri u = i.getParcelableExtra(Intent.EXTRA_STREAM);
                if (u != null) uris.add(u);
            } else if (Intent.ACTION_SEND_MULTIPLE.equals(acao)) {
                ArrayList<Uri> l = i.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
                if (l != null) uris.addAll(l);
            } else {
                return false;
            }
        } catch (Exception e) {
            return false;
        }
        boolean algum = false;
        for (Uri u : uris) {
            try (InputStream in = ctx.getContentResolver().openInputStream(u)) {
                if (in == null) continue;
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[16384];
                int n;
                long total = 0;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    total += n;
                    if (total > 20L * 1024 * 1024) break;
                }
                String tipo = ctx.getContentResolver().getType(u);
                if (tipo == null) tipo = i.getType() != null ? i.getType() : "image/jpeg";
                JSObject a = new JSObject();
                a.put("tipo", tipo);
                a.put("dados", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
                synchronized (fila) { fila.add(a); }
                algum = true;
            } catch (Exception ignored) {
            }
        }
        return algum;
    }

    @PluginMethod
    public void pegar(PluginCall call) {
        JSArray arr = new JSArray();
        synchronized (fila) {
            for (JSObject a : fila) arr.put(a);
            fila.clear();
        }
        call.resolve(new JSObject().put("arquivos", arr));
    }
}
