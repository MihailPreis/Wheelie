package org.happysanta.gd;

import java.nio.charset.Charset;
import org.happysanta.gd.Levels.Loader;

public class Helpers {
	public static Loader loader;

	public static GDActivity getGDActivity() {
		return GDActivity.shared;
	}

	public static Loader getLevelLoader() {
		return loader;
	}

	public static void logDebug(Object o) {}

	public static String decodeCp1251(byte[] data) {
		int length = 0;
		while (length < data.length && data[length] != 0) length++;
		return new String(data, 0, length, Charset.forName("windows-1251"));
	}
}
