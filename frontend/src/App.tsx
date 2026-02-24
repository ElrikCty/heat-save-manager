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
    SetSaveGamePath,
    SwitchProfile,
} from '../wailsjs/go/main/App';

type Profile = {
    name: string;
};

function App() {
    const [saveGamePath, setSaveGamePath] = useState('');
    const [saveGamePathInput, setSaveGamePathInput] = useState('');
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [activeProfile, setActiveProfile] = useState('');
    const [freshProfileName, setFreshProfileName] = useState('');
    const [saveProfileName, setSaveProfileName] = useState('');
    const [status, setStatus] = useState('Loading profiles...');
    const [isLoading, setIsLoading] = useState(true);
    const [renameTarget, setRenameTarget] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState('');
    const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

    const isModalOpen = renameTarget !== null || deleteTarget !== null;

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
            setSaveGamePathInput(paths.saveGamePath);
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

    async function onApplyPath() {
        const trimmed = saveGamePathInput.trim();
        if (!trimmed) {
            setStatus('SaveGame path cannot be empty.');
            return;
        }

        const normalized = trimmed.replace(/[\\/]+$/, '');
        if (!/[\\/]SaveGame$/i.test(normalized)) {
            setStatus('Path must point directly to the SaveGame folder.');
            return;
        }

        try {
            setIsLoading(true);
            setStatus('Applying SaveGame path...');
            await SetSaveGamePath(trimmed);
            await loadData();
            setStatus('SaveGame path updated.');
        } catch (error) {
            setStatus(`Path update failed: ${String(error)}`);
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

    function openRenameModal(profileName: string) {
        setRenameTarget(profileName);
        setRenameValue(profileName);
    }

    function closeRenameModal() {
        setRenameTarget(null);
        setRenameValue('');
    }

    async function confirmRenameProfile() {
        if (!renameTarget) {
            return;
        }

        const nextName = renameValue.trim();
        if (!nextName || nextName === renameTarget) {
            closeRenameModal();
            return;
        }

        try {
            setIsLoading(true);
            setStatus(`Renaming ${renameTarget} to ${nextName}...`);
            await RenameProfile(renameTarget, nextName);
            await loadData();
            setStatus(`Profile renamed to ${nextName}.`);
            closeRenameModal();
        } catch (error) {
            setStatus(`Rename failed: ${String(error)}`);
        } finally {
            setIsLoading(false);
        }
    }

    function openDeleteModal(profileName: string) {
        setDeleteTarget(profileName);
    }

    function closeDeleteModal() {
        setDeleteTarget(null);
    }

    function closeActiveModal() {
        if (renameTarget) {
            closeRenameModal();
            return;
        }

        if (deleteTarget) {
            closeDeleteModal();
        }
    }

    async function confirmDeleteProfile() {
        if (!deleteTarget) {
            return;
        }

        try {
            setIsLoading(true);
            setStatus(`Deleting ${deleteTarget}...`);
            await DeleteProfile(deleteTarget);
            await loadData();
            setStatus(`Profile deleted: ${deleteTarget}.`);
            closeDeleteModal();
        } catch (error) {
            setStatus(`Delete failed: ${String(error)}`);
        } finally {
            setIsLoading(false);
        }
    }

    useEffect(() => {
        void loadData();
    }, []);

    useEffect(() => {
        if (!isModalOpen) {
            return;
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !isLoading) {
                event.preventDefault();
                closeActiveModal();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isModalOpen, isLoading, renameTarget, deleteTarget]);

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
                    <div className="field-row">
                        <input
                            id="savegame-path-input"
                            value={saveGamePathInput}
                            onChange={(event) => setSaveGamePathInput(event.target.value)}
                            placeholder="C:\\Users\\<you>\\Documents\\Need for speed heat\\SaveGame"
                            disabled={isLoading || isModalOpen}
                        />
                        <button className="action-btn secondary" onClick={() => void onApplyPath()} disabled={isLoading || isModalOpen}>
                            Apply Path
                        </button>
                    </div>
                    <p className="field-hint">Path must point directly to the `SaveGame` folder.</p>
                    <button className="refresh-btn" onClick={() => void loadData()} disabled={isLoading || isModalOpen}>
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
                            disabled={isLoading || isModalOpen}
                        />
                        <button className="action-btn" onClick={() => void onPrepareFresh()} disabled={isLoading || isModalOpen}>
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
                            disabled={isLoading || isModalOpen}
                        />
                        <button className="action-btn secondary" onClick={() => void onSaveCurrent()} disabled={isLoading || isModalOpen}>
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
                                            disabled={isLoading || isActive || isModalOpen}
                                        >
                                            {isActive ? 'Active' : 'Switch'}
                                        </button>
                                        <button
                                            className="switch-btn secondary"
                                            onClick={() => openRenameModal(profile.name)}
                                            disabled={isLoading || isModalOpen}
                                            aria-label={`Rename profile ${profile.name}`}
                                        >
                                            Rename
                                        </button>
                                        <button
                                            className="switch-btn danger"
                                            onClick={() => openDeleteModal(profile.name)}
                                            disabled={isLoading || isActive || isModalOpen}
                                            aria-label={`Delete profile ${profile.name}`}
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

            {renameTarget && (
                <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="rename-modal-title" aria-describedby="rename-modal-description">
                    <div className="modal-card" onClick={(event) => event.stopPropagation()}>
                        <h3 id="rename-modal-title">Rename Profile</h3>
                        <p id="rename-modal-description">Choose a new name for <strong>{renameTarget}</strong>.</p>
                        <input
                            value={renameValue}
                            onChange={(event) => setRenameValue(event.target.value)}
                            disabled={isLoading}
                            autoFocus
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    event.preventDefault();
                                    void confirmRenameProfile();
                                }
                            }}
                        />
                        <div className="modal-actions">
                            <button className="switch-btn secondary" onClick={closeRenameModal} disabled={isLoading}>
                                Cancel
                            </button>
                            <button className="action-btn" onClick={() => void confirmRenameProfile()} disabled={isLoading}>
                                Rename
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {deleteTarget && (
                <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="delete-modal-title" aria-describedby="delete-modal-description">
                    <div className="modal-card danger" onClick={(event) => event.stopPropagation()}>
                        <h3 id="delete-modal-title">Delete Profile</h3>
                        <p id="delete-modal-description">Delete <strong>{deleteTarget}</strong>? This action cannot be undone.</p>
                        <div className="modal-actions">
                            <button className="switch-btn secondary" onClick={closeDeleteModal} disabled={isLoading}>
                                Cancel
                            </button>
                            <button className="switch-btn danger" onClick={() => void confirmDeleteProfile()} disabled={isLoading}>
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default App;
