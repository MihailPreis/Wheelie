package org.happysanta.gd.Menu;

// Stand-in for the original class, which doubles as a menu widget and as a physics state record.
// Only the physics fields are kept.
public class SimpleMenuElement {
	public int x;
	public int y;
	public int m_bI;
	public int m_eI;
	public int m_dI;
	public int m_gotoI;
	public int m_nullI;
	public int m_longI;
	public int m_fI;

	public SimpleMenuElement() {
		init();
	}

	public void init() {
		x = y = m_bI = 0;
		m_eI = m_dI = m_gotoI = 0;
		m_nullI = m_longI = m_fI = 0;
	}
}
