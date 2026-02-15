import {useEffect, useState} from 'react';
import './App.css';
import {GetActiveProfile, GetPaths, ListProfiles, SwitchProfile} from '../wailsjs/go/main/App';

type Profile = {
    name: string;
};

function App() {
    const [saveGamePath, setSaveGamePath] = useState('');
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [activeProfile, setActiveProfile] = useState('');
    const [status, setStatus] = useState('Loading profiles...');
    const [isLoading, setIsLoading] = useState(true);

    const statusTone = status.startsWith('Failed') || status.startsWith('Switch failed')
        ? 'danger'
        : isLoading
            ? 'loading'
            : 'ok';

    async function loadData() {
        try {
            setIsLoading(true);
            const [paths, profileItems] = await Promise.all([GetPaths(), ListProfiles()]);
            setSaveGamePath(paths.saveGamePath);
            setProfiles(profileItems);

            try {
                const active = await GetActiveProfile();
                setActiveProfile(active);
            } catch {
                setActiveProfile('');
            }

            setStatus('Ready');
        } catch (error) {
            setStatus(`Failed to load profiles: ${String(error)}`);
        } finally {
            setIsLoading(false);
        }
    }

    async function onSwitch(profileName: string) {
        try {
            setStatus(`Switching to ${profileName}...`);
            setIsLoading(true);
            await SwitchProfile(profileName);
            setActiveProfile(profileName);
            setStatus(`Active profile: ${profileName}`);
        } catch (error) {
            setStatus(`Switch failed: ${String(error)}`);
        } finally {
            setIsLoading(false);
        }
    }

    useEffect(() => {
        void loadData();
    }, []);

    return (
        <div className="app-shell">
            <header className="hero">
                <p className="eyebrow">Need for Speed Heat</p>
                <h1>Heat Save Manager</h1>
                <p className={`status ${statusTone}`}>{status}</p>
            </header>

            <main className="dashboard">
                <section className="panel metadata-panel">
                    <h2>SaveGame Path</h2>
                    <p className="path">{saveGamePath || 'Not set'}</p>
                    <button className="refresh-btn" onClick={() => void loadData()} disabled={isLoading}>
                        {isLoading ? 'Refreshing...' : 'Refresh'}
                    </button>
                </section>

                <section className="panel profile-panel">
                    <h2>Profiles</h2>
                    {profiles.length === 0 && <p className="empty">No profiles found in the Profiles folder.</p>}
                    <div className="profile-list">
                        {profiles.map((profile) => {
                            const isActive = profile.name === activeProfile;

                            return (
                                <article key={profile.name} className={`profile-card ${isActive ? 'active' : ''}`}>
                                    <div>
                                        <h3>{profile.name}</h3>
                                        <p>{isActive ? 'Currently active' : 'Ready to activate'}</p>
                                    </div>
                                    <button
                                        className="switch-btn"
                                        onClick={() => void onSwitch(profile.name)}
                                        disabled={isLoading || isActive}
                                    >
                                        {isActive ? 'Active' : 'Switch'}
                                    </button>
                                </article>
                            );
                        })}
                    </div>
                </section>
            </main>
            <footer className="footnote">
                <p>Marker file: active_profile.txt</p>
            </footer>
        </div>
    );
}

export default App;
