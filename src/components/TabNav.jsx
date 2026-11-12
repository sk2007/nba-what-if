export default function TabNav({ activeTab, onTabChange }) {
  const tabs = ['Play Editor', 'Stat Model'];

  return (
    <nav style={styles.nav}>
      {tabs.map((tab) => (
        <button
          key={tab}
          onClick={() => onTabChange(tab)}
          style={{
            ...styles.tab,
            ...(activeTab === tab ? styles.activeTab : {}),
          }}
        >
          {tab}
        </button>
      ))}
    </nav>
  );
}

const styles = {
  nav: {
    display: 'flex',
    gap: '4px',
    borderBottom: '2px solid var(--line)',
    marginBottom: '24px',
  },
  tab: {
    padding: '10px 20px',
    border: 'none',
    background: 'none',
    cursor: 'pointer',
    fontSize: '15px',
    fontWeight: '500',
    color: 'var(--text-secondary)',
    borderBottom: '2px solid transparent',
    marginBottom: '-2px',
    transition: 'color 0.15s',
  },
  activeTab: {
    color: 'var(--text-primary)',
    borderBottom: '2px solid var(--text-primary)',
  },
};
