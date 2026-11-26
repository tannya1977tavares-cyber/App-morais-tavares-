package br.com.moraistavares.orcamento;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

/** Lê o texto de um comprovante (foto ou print) no próprio celular, sem internet. */
@CapacitorPlugin(name = "LerTexto")
public class LerTextoPlugin extends Plugin {
    private TextRecognizer leitor;

    @PluginMethod
    public void ler(PluginCall call) {
        try {
            byte[] b = Base64.decode(call.getString("imagem", ""), Base64.DEFAULT);
            BitmapFactory.Options o = new BitmapFactory.Options();
            o.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(b, 0, b.length, o);
            int lado = Math.max(o.outWidth, o.outHeight), amostra = 1;
            while (lado / amostra > 2400) amostra *= 2;
            o = new BitmapFactory.Options();
            o.inSampleSize = amostra;
            Bitmap bmp = BitmapFactory.decodeByteArray(b, 0, b.length, o);
            if (bmp == null) { call.reject("imagem-invalida"); return; }
            if (leitor == null) leitor = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
            leitor.process(InputImage.fromBitmap(bmp, 0))
                    .addOnSuccessListener(t -> call.resolve(new JSObject().put("texto", t.getText())))
                    .addOnFailureListener(e -> call.reject("falha-leitura: " + e.getMessage()));
        } catch (Exception e) {
            call.reject("falha-leitura: " + e.getMessage());
        }
    }
}
