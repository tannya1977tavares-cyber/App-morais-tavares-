package br.com.moraistavares.orcamento;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WhatsEnviarPlugin.class);
        registerPlugin(VozPlugin.class);
        registerPlugin(AtualizadorPlugin.class);
        registerPlugin(LerTextoPlugin.class);
        registerPlugin(RecebidosPlugin.class);
        super.onCreate(savedInstanceState);
        tratar(getIntent());
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        tratar(intent);
    }

    private void tratar(Intent intent) {
        try {
            if (intent == null || getBridge() == null) return;
            // comprovante compartilhado pro app (WhatsApp, banco, galeria)
            if (RecebidosPlugin.guardar(this, intent)) {
                intent.setAction(Intent.ACTION_MAIN);
                getBridge().getWebView().postDelayed(() -> getBridge().triggerWindowJSEvent("comprovantesRecebidos"), 1200);
                return;
            }
            // toque no "Colar pedido" do widget
            String acao = intent.getStringExtra("abrir");
            if (acao == null) return;
            intent.removeExtra("abrir");
            if (!"colar".equals(acao)) return;
            final String url = getBridge().getLocalUrl() + "/index.html#colar";
            getBridge().getWebView().post(() -> getBridge().getWebView().loadUrl(url));
        } catch (Exception ignored) {
        }
    }
}
