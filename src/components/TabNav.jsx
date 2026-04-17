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
    borderBottom: '2px solid #e0e0e0',
    marginBottom: '24px',
  },
  tab: {
    padding: '10px 20px',
    border: 'none',
    background: 'none',
    cursor: 'pointer',
    fontSize: '15px',
    fontWeight: '500',
    color: '#666',
    borderBottom: '2px solid transparent',
    marginBottom: '-2px',
    transition: 'color 0.15s',
  },
  activeTab: {
    color: '#1a1a1a',
    borderBottom: '2px solid #1a1a1a',
  },
};
