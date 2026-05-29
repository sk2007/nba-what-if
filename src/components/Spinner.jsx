export default function Spinner({ message, hint }) {
  return (
    <div style={s.wrapper}>
      <div style={s.scene}>
        <div style={s.ball}>🏀</div>
        <div style={s.shadow} />
      </div>
      {message && <p style={s.message}>{message}</p>}
      {hint && <p style={s.hint}>{hint}</p>}
      <style>{anim}</style>
    </div>
  );
}

const anim = `
@keyframes bounce {
  0%, 100% { transform: translateY(0px); animation-timing-function: cubic-bezier(0.33,0,0.66,0); }
  50%       { transform: translateY(-36px); animation-timing-function: cubic-bezier(0.33,1,0.66,1); }
}
@keyframes shadow-pulse {
  0%, 100% { transform: scaleX(1); opacity: 0.25; }
  50%       { transform: scaleX(0.45); opacity: 0.08; }
}
@keyframes fade-in {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
`;

const s = {
  wrapper: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '48px 0 40px',
    animation: 'fade-in 0.3s ease both',
  },
  scene: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '6px',
    marginBottom: '20px',
  },
  ball: {
    fontSize: '36px',
    lineHeight: 1,
    animation: 'bounce 0.7s ease infinite',
    userSelect: 'none',
  },
  shadow: {
    width: '28px',
    height: '7px',
    background: '#1a1a1a',
    borderRadius: '50%',
    animation: 'shadow-pulse 0.7s ease infinite',
  },
  message: {
    fontSize: '14px',
    fontWeight: '600',
    color: '#333',
    margin: '0 0 4px',
    textAlign: 'center',
  },
  hint: {
    fontSize: '12px',
    color: '#aaa',
    margin: 0,
    textAlign: 'center',
  },
};
