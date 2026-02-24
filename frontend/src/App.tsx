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
    RunHealthCheck,
} from '../wailsjs/go/main/App';

type Profile = {
    name: string;
};

type HealthItem = {
    name: string;
    ok: boolean;
    severity: string;
    message: string;
};

type HealthReport = {
    ready: boolean;
    checkedAt: string;
    items: HealthItem[];
};

type ErrorFeedback = {
    message: string;
    hint: string;
};

function normalizeError(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    return String(error);
}

function toErrorFeedback(error: unknown, fallback: string): ErrorFeedback {
    const detail = normalizeError(error);
    const lowered = detail.toLowerCase();

    if (lowered.includes('cannot delete active profile')) {
        return {
            message: 'You cannot delete the active profile.',
            hint: 'Switch to a different profile, then delete this one.',
        };
    }

    if (lowered.includes('root savegame folder is missing') || lowered.includes('root wraps folder is missing')) {
        return {
            message: 'Current root save folders are missing.',
            hint: 'Open the game once to regenerate save folders, then try again.',
        };
    }

    if (lowered.includes('savegame path') || lowered.includes('path must point to the savegame folder')) {
        return {
            message: 'SaveGame path is invalid.',
            hint: 'Set the exact SaveGame directory path in the path panel.',
        };
    }

    if (lowered.includes('invalid characters') || lowered.includes('profile name is required')) {
        return {
            message: 'Profile name is invalid.',
            hint: 'Use letters/numbers and avoid Windows invalid filename characters.',
        };
    }

    if (lowered.includes('already exists')) {
        return {
            message: 'That profile name already exists.',
            hint: 'Pick another name or rename the existing profile first.',
        };
    }

    if (lowered.includes('profile not found')) {
        return {
            message: 'Selected profile no longer exists.',
            hint: 'Refresh profiles and try again.',
        };
    }

    if (lowered.includes('access is denied') || lowered.includes('being used by another process')) {
        return {
            message: 'Files are currently locked by another process.',
            hint: 'Close the game and any tools touching save files, then retry.',
        };
    }

    return {
        message: `${fallback}: ${detail}`,
        hint: '',
    };
}

function App() {
    const [saveGamePath, setSaveGamePath] = useState('');
    const [saveGamePathInput, setSaveGamePathInput] = useState('');
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [activeProfile, setActiveProfile] = useState('');
    const [freshProfileName, setFreshProfileName] = useState('');
    const [saveProfileName, setSaveProfileName] = useState('');
    const [status, setStatus] = useState('Loading profiles...');
    const [recoveryHint, setRecoveryHint] = useState('');
    const [healthReport, setHealthReport] = useState<HealthReport | null>(null);
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
            const [paths, profileItems, health] = await Promise.all([GetPaths(), ListProfiles(), RunHealthCheck()]);
            setSaveGamePath(paths.saveGamePath);
            setSaveGamePathInput(paths.saveGamePath);
            setProfiles(profileItems);
            setHealthReport(health);

            try {
                const active = await GetActiveProfile();
                setActiveProfile(active);
            } catch {
                setActiveProfile('');
            }

            setStatus('Ready');
            setRecoveryHint('');
        } catch (error) {
            const feedback = toErrorFeedback(error, 'Failed to load profiles');
            setStatus(feedback.message);
            setRecoveryHint(feedback.hint);
        } finally {
            setIsLoading(false);
        }
    }

    async function onRunHealthCheck() {
        try {
            setIsLoading(true);
            setStatus('Running diagnostics...');
            setRecoveryHint('');
            const report = await RunHealthCheck();
            setHealthReport(report);
            setStatus(report.ready ? 'Diagnostics complete: setup looks ready.' : 'Diagnostics complete: action needed.');
        } catch (error) {
            const feedback = toErrorFeedback(error, 'Diagnostics failed');
            setStatus(feedback.message);
            setRecoveryHint(feedback.hint);
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
            setRecoveryHint('');
            await SetSaveGamePath(trimmed);
            await loadData();
            setStatus('SaveGame path updated.');
        } catch (error) {
            const feedback = toErrorFeedback(error, 'Path update failed');
            setStatus(feedback.message);
            setRecoveryHint(feedback.hint);
        } finally {
            setIsLoading(false);
        }
    }

    async function onSwitch(profileName: string) {
        try {
            setStatus(`Switching to ${profileName}...`);
            setIsLoading(true);
            setRecoveryHint('');
            await SwitchProfile(profileName);
            setActiveProfile(profileName);
            setStatus(`Active profile: ${profileName}`);
        } catch (error) {
            const feedback = toErrorFeedback(error, 'Switch failed');
            setStatus(feedback.message);
            setRecoveryHint(feedback.hint);
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
            setRecoveryHint('');
            await PrepareFreshProfile(name);
            setFreshProfileName('');
            setActiveProfile(name);
            await loadData();
            setStatus(`Fresh profile prepared: ${name}. Start the game to generate a new save.`);
        } catch (error) {
            const feedback = toErrorFeedback(error, 'Fresh profile prep failed');
            setStatus(feedback.message);
            setRecoveryHint(feedback.hint);
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
            setRecoveryHint('');
            await SaveCurrentProfile(requested);
            setSaveProfileName('');
            await loadData();
            setStatus(`Current root save exported to ${target}.`);
        } catch (error) {
            const feedback = toErrorFeedback(error, 'Save current failed');
            setStatus(feedback.message);
            setRecoveryHint(feedback.hint);
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
            setRecoveryHint('');
            await RenameProfile(renameTarget, nextName);
            await loadData();
            setStatus(`Profile renamed to ${nextName}.`);
            closeRenameModal();
        } catch (error) {
            const feedback = toErrorFeedback(error, 'Rename failed');
            setStatus(feedback.message);
            setRecoveryHint(feedback.hint);
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
            setRecoveryHint('');
            await DeleteProfile(deleteTarget);
            await loadData();
            setStatus(`Profile deleted: ${deleteTarget}.`);
            closeDeleteModal();
        } catch (error) {
            const feedback = toErrorFeedback(error, 'Delete failed');
            setStatus(feedback.message);
            setRecoveryHint(feedback.hint);
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
                {recoveryHint && <p className="status-hint">Tip: {recoveryHint}</p>}
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

                <section className="panel diagnostics-panel">
                    <h2>Diagnostics</h2>
                    <div className="diagnostics-summary">
                        <p>
                            Status:{' '}
                            <span className={healthReport ? (healthReport.ready ? 'diag-ready' : 'diag-attention') : 'diag-pending'}>
                                {healthReport ? (healthReport.ready ? 'Ready' : 'Needs attention') : 'Not run yet'}
                            </span>
                        </p>
                        <p>Last run: {healthReport?.checkedAt ? new Date(healthReport.checkedAt).toLocaleString() : 'Not run yet'}</p>
                    </div>
                    <button className="refresh-btn" onClick={() => void onRunHealthCheck()} disabled={isLoading || isModalOpen}>
                        {isLoading ? 'Running...' : 'Run Diagnostics'}
                    </button>
                    {healthReport && (
                        <ul className="health-list">
                            {healthReport.items.map((item) => (
                                <li key={item.name} className={`health-item ${item.severity}`}>
                                    <strong>{item.name.replaceAll('_', ' ')}</strong>
                                    <span>{item.message}</span>
                                </li>
                            ))}
                        </ul>
                    )}
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
