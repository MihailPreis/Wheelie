package org.happysanta.gd;

import java.io.IOException;
import java.io.InputStream;

public class GDActivity {
	public static GDActivity shared = new GDActivity();

	public static class Assets {
		public InputStream open(String name) throws IOException {
			throw new IOException("No bundled assets in the harness: " + name);
		}
	}

	public Assets getAssets() {
		return new Assets();
	}

	public boolean isMenuShown() {
		return false;
	}
}
