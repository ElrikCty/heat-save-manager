import {useEffect, useState} from 'react';
import './App.css';
import {
    DeleteProfile,
    GetActiveProfile,
    GetPaths,
    ListProfiles,
    PrepareFreshProfile,
    RenameProfile,
    SaveCurrentProfile,
    SwitchProfile,
} from '../wailsjs/go/main/App';

type Profile = {
    name: string;
};

function App() {
    const [saveGamePath, setSaveGamePath] = useState('');
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [activeProfile, setActiveProfile] = useState('');
    const [freshProfileName, setFreshProfileName] = useState('');
    const [saveProfileName, setSaveProfileName] = useState('');
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

    async function onPrepareFresh() {
        const name = freshProfileName.trim();
        if (!name) {
            setStatus('Choose a profile name before preparing a fresh save.');
            return;
        }

        try {
            setIsLoading(true);
            setStatus(`Preparing fresh profile ${name}...`);
            await PrepareFreshProfile(name);
            setFreshProfileName('');
            setActiveProfile(name);
            await loadData();
            setStatus(`Fresh profile prepared: ${name}. Start the game to generate a new save.`);
        } catch (error) {
            setStatus(`Fresh profile prep failed: ${String(error)}`);
        } finally {
            setIsLoading(false);
        }
    }

    async function onSaveCurrent() {
        const requested = saveProfileName.trim();
        const target = requested || activeProfile || 'active profile marker';

        try {
            setIsLoading(true);
            setStatus(`Saving current root data into ${target}...`);
            await SaveCurrentProfile(requested);
            setSaveProfileName('');
            await loadData();
            setStatus(`Current root save exported to ${target}.`);
        } catch (error) {
            setStatus(`Save current failed: ${String(error)}`);
        } finally {
            setIsLoading(false);
        }
    }

    async function onRenameProfile(oldName: string) {
        const newName = window.prompt(`Rename profile "${oldName}" to:`, oldName);
        if (!newName || newName.trim() === '' || newName.trim() === oldName) {
            return;
        }

        try {
            setIsLoading(true);
            setStatus(`Renaming ${oldName} to ${newName.trim()}...`);
            await RenameProfile(oldName, newName.trim());
            await loadData();
            setStatus(`Profile renamed to ${newName.trim()}.`);
        } catch (error) {
            setStatus(`Rename failed: ${String(error)}`);
        } finally {
            setIsLoading(false);
        }
    }

    async function onDeleteProfile(profileName: string) {
        const shouldDelete = window.confirm(`Delete profile "${profileName}"? This cannot be undone.`);
        if (!shouldDelete) {
            return;
        }

        try {
            setIsLoading(true);
            setStatus(`Deleting ${profileName}...`);
            await DeleteProfile(profileName);
            await loadData();
            setStatus(`Profile deleted: ${profileName}.`);
        } catch (error) {
            setStatus(`Delete failed: ${String(error)}`);
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

                <section className="panel actions-panel">
                    <h2>Lifecycle Actions</h2>
                    <label className="field-label" htmlFor="fresh-profile-input">Prepare fresh profile</label>
                    <div className="field-row">
                        <input
                            id="fresh-profile-input"
                            value={freshProfileName}
                            onChange={(event) => setFreshProfileName(event.target.value)}
                            placeholder="New profile name"
                            disabled={isLoading}
                        />
                        <button className="action-btn" onClick={() => void onPrepareFresh()} disabled={isLoading}>
                            Prepare
                        </button>
                    </div>

                    <label className="field-label" htmlFor="save-profile-input">Save current root to profile</label>
                    <div className="field-row">
                        <input
                            id="save-profile-input"
                            value={saveProfileName}
                            onChange={(event) => setSaveProfileName(event.target.value)}
                            placeholder="Leave blank to use active"
                            disabled={isLoading}
                        />
                        <button className="action-btn secondary" onClick={() => void onSaveCurrent()} disabled={isLoading}>
                            Save
                        </button>
                    </div>
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
                                    <div className="profile-actions">
                                        <button
                                            className="switch-btn"
                                            onClick={() => void onSwitch(profile.name)}
                                            disabled={isLoading || isActive}
                                        >
                                            {isActive ? 'Active' : 'Switch'}
                                        </button>
                                        <button
                                            className="switch-btn secondary"
                                            onClick={() => void onRenameProfile(profile.name)}
                                            disabled={isLoading}
                                        >
                                            Rename
                                        </button>
                                        <button
                                            className="switch-btn danger"
                                            onClick={() => void onDeleteProfile(profile.name)}
                                            disabled={isLoading || isActive}
                                        >
                                            Delete
                                        </button>
                                    </div>
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
