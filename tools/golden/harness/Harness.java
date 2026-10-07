import java.io.File;
import java.io.PrintStream;
import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.List;
import org.happysanta.gd.Game.Physics;
import org.happysanta.gd.Game.k;
import org.happysanta.gd.Helpers;
import org.happysanta.gd.Levels.Loader;
import org.happysanta.gd.Menu.SimpleMenuElement;

/**
 * Runs the original, unmodified physics headless and records what it does, one JSON object per
 * scenario per line. The web port must reproduce every recorded hash.
 *
 * Usage: java Harness <levels.mrg> <pack name> [--dump <scenario index>]
 */
public class Harness {
	static final int MAX_TICKS = 4000;
	static final int CHECKPOINT_EVERY = 128;
	static final int TICKS_AFTER_FINISH = 66;
	static final int TICKS_AFTER_CRASH = 200;

	static final String[] PHYSICS_INTS = {"m_vaI", "m_waI", "m_xaI", "m_cI", "m_EI", "m_CI", "m_TI", "m_kI"};
	static final String[] PHYSICS_FLAGS = {"m_IZ", "m_mZ", "m_RZ", "m_NZ", "m_vZ", "m_dZ", "m_FZ", "m_XZ", "m_wZ"};
	static final String[] LOADER_INTS = {"m_eaI", "m_faI", "m_eI", "m_dI"};

	static int hash;

	static void word(int value) {
		for (int shift = 0; shift < 32; shift += 8) {
			hash ^= (value >>> shift) & 0xff;
			hash *= 16777619;
		}
	}

	static Object get(Object target, String name) throws Exception {
		Field field = target.getClass().getDeclaredField(name);
		field.setAccessible(true);
		return field.get(target);
	}

	/** Collects the simulation state in a fixed order. The port serialises its state the same way. */
	static List<Integer> state(Physics physics, Loader loader) throws Exception {
		List<Integer> words = new ArrayList<Integer>();
		for (int i = 0; i < 6; i++) {
			k body = physics.m_Hak[i];
			words.add(body.m_aI);
			words.add(body.m_intI);
			words.add(body.m_forI);
			words.add(body.m_newI);
			// Slot 5 is the snapshot taken for rendering, not simulation state.
			for (int j = 0; j < 5; j++) {
				SimpleMenuElement e = body.m_ifan[j];
				words.add(e.x);
				words.add(e.y);
				words.add(e.m_bI);
				words.add(e.m_eI);
				words.add(e.m_dI);
				words.add(e.m_gotoI);
				words.add(e.m_nullI);
				words.add(e.m_longI);
				words.add(e.m_fI);
			}
		}
		for (String name : PHYSICS_INTS) words.add((Integer) get(physics, name));
		for (String name : PHYSICS_FLAGS) words.add(((Boolean) get(physics, name)) ? 1 : 0);
		for (String name : LOADER_INTS) words.add((Integer) get(loader, name));
		return words;
	}

	static int stateHash(Physics physics, Loader loader) throws Exception {
		hash = 0x811c9dc5;
		for (int value : state(physics, loader)) word(value);
		return hash;
	}

	static int random;

	static int nextRandom() {
		random ^= random << 13;
		random ^= random >>> 17;
		random ^= random << 5;
		return random & 0x7fffffff;
	}

	static void appendRun(StringBuilder out, int a, int b, int count) {
		if (out.length() > 0) out.append(',');
		out.append('[').append(a).append(',').append(b).append(',').append(count).append(']');
	}

	static void appendRun(StringBuilder out, int a, int count) {
		if (out.length() > 0) out.append(',');
		out.append('[').append(a).append(',').append(count).append(']');
	}

	static final int[] THROTTLE_CHOICES = {1, 1, 1, 0, -1};
	static final int[] LEAN_CHOICES = {-1, 0, 0, 1};
	static final int[] LEAN_HEAVY_CHOICES = {-1, -1, 0, 1, 1};

	static void run(PrintStream out, File file, String pack, int level, int track, int league, String kind,
			boolean dump) throws Exception {
		Loader loader = new Loader(file);
		Helpers.loader = loader;
		Physics physics = new Physics(loader);
		physics._byteIV(1);
		loader._doIII(level, track);
		physics.setLeague(league);
		if (kind.equals("demo")) {
			physics._casevV();
		} else {
			physics._avV();
			physics._doZV(true);
		}

		random = 0x9e3779b9 ^ (level * 7919 + track * 104729 + league * 1299709 + kind.hashCode());
		if (random == 0) random = 1;

		StringBuilder inputs = new StringBuilder();
		StringBuilder statuses = new StringBuilder();
		StringBuilder checkpoints = new StringBuilder();
		String error = null;

		int throttle = 0, lean = 0, hold = 0;
		int runThrottle = 0, runLean = 0, runInputs = 0;
		int runStatus = -1, runStatuses = 0;
		int ticks = 0;
		int remainingAfterEnd = -1;

		while (ticks < MAX_TICKS) {
			if (kind.equals("throttle")) {
				throttle = 1;
				lean = 0;
			} else if (kind.equals("demo")) {
				throttle = 0;
				lean = 0;
			} else if (kind.equals("pilot")) {
				// Full throttle, balancing the way the built-in demo rider does, with occasional slips.
				if (hold == 0) {
					int current = (Integer) get(physics, "m_vaI");
					int tilt = physics.m_Hak[1].m_ifan[current].y - physics.m_Hak[2].m_ifan[current].y;
					throttle = 1;
					lean = tilt < 0 ? -1 : (tilt > 0 ? 1 : 0);
					if (nextRandom() % 40 == 0) {
						throttle = THROTTLE_CHOICES[nextRandom() % THROTTLE_CHOICES.length];
						lean = LEAN_CHOICES[nextRandom() % LEAN_CHOICES.length];
						hold = 3 + nextRandom() % 12;
					}
				}
			} else if (hold == 0) {
				int[] leans = kind.equals("lean") ? LEAN_HEAVY_CHOICES : LEAN_CHOICES;
				throttle = THROTTLE_CHOICES[nextRandom() % THROTTLE_CHOICES.length];
				lean = leans[nextRandom() % leans.length];
				hold = 5 + nextRandom() % 56;
			}
			if (hold > 0) hold--;

			if (runInputs > 0 && (throttle != runThrottle || lean != runLean)) {
				appendRun(inputs, runThrottle, runLean, runInputs);
				runInputs = 0;
			}
			runThrottle = throttle;
			runLean = lean;
			runInputs++;

			int status;
			try {
				physics._aIIV(throttle, lean);
				status = physics._dovI();
			} catch (RuntimeException e) {
				error = e.getClass().getSimpleName();
				break;
			}
			ticks++;

			if (dump) {
				StringBuilder line = new StringBuilder();
				line.append(ticks).append(' ').append(status);
				for (int value : state(physics, loader)) line.append(' ').append(value);
				out.println(line);
			}

			if (runStatuses > 0 && status != runStatus) {
				appendRun(statuses, runStatus, runStatuses);
				runStatuses = 0;
			}
			runStatus = status;
			runStatuses++;

			if (ticks % CHECKPOINT_EVERY == 0) {
				if (checkpoints.length() > 0) checkpoints.append(',');
				checkpoints.append(stateHash(physics, loader));
			}

			if (status == 5) break;
			if (remainingAfterEnd < 0) {
				if (status == 1 || status == 2) remainingAfterEnd = TICKS_AFTER_FINISH;
				else if (status == 3) remainingAfterEnd = TICKS_AFTER_CRASH;
			} else if (--remainingAfterEnd == 0) {
				break;
			}
		}
		if (runInputs > 0) appendRun(inputs, runThrottle, runLean, runInputs);
		if (runStatuses > 0) appendRun(statuses, runStatus, runStatuses);
		if (dump) return;

		StringBuilder line = new StringBuilder();
		line.append("{\"pack\":\"").append(pack).append('"');
		line.append(",\"level\":").append(level);
		line.append(",\"track\":").append(track);
		line.append(",\"league\":").append(league);
		line.append(",\"kind\":\"").append(kind).append('"');
		line.append(",\"ticks\":").append(ticks);
		line.append(",\"inputs\":[").append(inputs).append(']');
		line.append(",\"statuses\":[").append(statuses).append(']');
		line.append(",\"checkpoints\":[").append(checkpoints).append(']');
		line.append(",\"final\":").append(stateHash(physics, loader));
		if (error != null) line.append(",\"error\":\"").append(error).append('"');
		line.append('}');
		out.println(line);
	}

	public static void main(String[] args) throws Exception {
		File file = new File(args[0]);
		String pack = args[1];
		int dumpIndex = args.length > 3 && args[2].equals("--dump") ? Integer.parseInt(args[3]) : -1;

		Loader probe = new Loader(file);
		int index = 0;
		for (int level = 0; level < 3; level++) {
			int tracks = probe.names[level].length;
			for (int track = 0; track < tracks; track++) {
				List<Object[]> scenarios = new ArrayList<Object[]>();
				for (int league = 0; league < 4; league++) scenarios.add(new Object[] {league, "throttle"});
				scenarios.add(new Object[] {track % 4, "random"});
				scenarios.add(new Object[] {(track + 2) % 4, "lean"});
				scenarios.add(new Object[] {1, "demo"});
				scenarios.add(new Object[] {(track + 1) % 4, "pilot"});
				scenarios.add(new Object[] {(track + 3) % 4, "pilot"});
				for (Object[] scenario : scenarios) {
					if (dumpIndex < 0 || dumpIndex == index) {
						run(System.out, file, pack, level, track, (Integer) scenario[0], (String) scenario[1],
								dumpIndex >= 0);
					}
					index++;
				}
			}
		}
	}
}
