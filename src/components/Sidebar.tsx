/** Panel samping: daftar ruang + identitas pengguna. */
import { useStore } from '../store/store'
import { Avatar } from '../components/ui'

export function Sidebar({ tampil, tutup }: { tampil: boolean; tutup: () => void }) {
  const { rooms, ruangAktif, pilihRuang, user, keluar } = useStore()

  return (
    <aside className={`sidebar ${tampil ? 'tampil' : ''}`}>
      <div className="sidebar-kepala">
        <div className="brand">Ngobrol<span>.</span></div>
        {user && (
          <div className="saya">
            <Avatar nama={user.username} ukuran={24} />
            <span>@{user.username}</span>
          </div>
        )}
      </div>

      <div className="daftar-ruang">
        <div className="ruang-label">Ruang obrolan</div>
        {rooms.map(r => (
          <button
            key={r.slug}
            className={`ruang-tombol ${ruangAktif === r.slug ? 'aktif' : ''}`}
            onClick={() => { pilihRuang(r.slug); tutup() }}
            title={r.description}
          >
            <span className="hash">#</span>
            <span style={{ flex: 1 }}>{r.name}</span>
            {r.messageCount > 0 && (
              <span style={{ fontSize: 11, opacity: .6 }}>{r.messageCount}</span>
            )}
          </button>
        ))}
      </div>

      <div className="sidebar-kaki">
        <button className="tombol garis" style={{ width: '100%' }} onClick={keluar}>
          Keluar
        </button>
      </div>
    </aside>
  )
}
