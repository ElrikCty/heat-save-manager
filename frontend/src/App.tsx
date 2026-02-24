import {useEffect, useState} from 'react';
import './App.css';
import {
    CreateMarkerFile,
    DeleteProfile,
    EnsureProfilesFolder,
    ExportProfileBundle,
    GetActiveProfile,
    GetPaths,
    ImportProfileBundle,
    ListProfiles,
    PickExportBundlePath,
    PickImportBundlePath,
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

    if (lowered.includes('bundle contains invalid file path')) {
        return {
            message: 'Bundle file is unsafe or malformed.',
            hint: 'Use a bundle exported by this app and try again.',
        };
    }

    if (lowered.includes('invalid profile layout')) {
        return {
            message: 'Profile bundle is missing required folders.',
            hint: 'Bundle must include both savegame and wraps folders.',
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
    const [exportProfileName, setExportProfileName] = useState('');
    const [exportBundlePath, setExportBundlePath] = useState('');
    const [importProfileName, setImportProfileName] = useState('');
    const [importBundlePath, setImportBundlePath] = useState('');
    const [status, setStatus] = useState('Loading profiles...');
    const [recoveryHint, setRecoveryHint] = useState('');
    const [healthReport, setHealthReport] = useState<HealthReport | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [renameTarget, setRenameTarget] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState('');
    const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
    const [markerQuickProfile, setMarkerQuickProfile] = useState('');

    const isModalOpen = renameTarget !== null || deleteTarget !== null;

    const loweredStatus = status.toLowerCase();
    const statusTone = loweredStatus.includes('failed') || loweredStatus.includes('invalid') || loweredStatus.includes('cannot')
        ? 'danger'
        : isLoading
            ? 'loading'
            : 'ok';

    const canApplyPath = saveGamePathInput.trim() !== '';
    const canPrepareFresh = freshProfileName.trim() !== '';
    const canSaveCurrent = saveProfileName.trim() !== '' || activeProfile.trim() !== '';
    const canExportBundle = exportProfileName.trim() !== '' && exportBundlePath.trim() !== '';
    const canImportBundle = importProfileName.trim() !== '' && importBundlePath.trim() !== '';
    const markerHealthItem = healthReport?.items.find((item) => item.name === 'marker_file') ?? null;
    const needsProfilesFolderFix = healthReport?.items.some((item) => item.name === 'profiles_path' && !item.ok) ?? false;
    const needsMarkerFileFix = markerHealthItem?.message.toLowerCase().includes('is missing') ?? false;

    async function loadData() {
        try {
            setIsLoading(true);
            const [paths, profileItems, health] = await Promise.all([GetPaths(), ListProfiles(), RunHealthCheck()]);
            setSaveGamePath(paths.saveGamePath);
            setSaveGamePathInput(paths.saveGamePath);
            setProfiles(profileItems);
            setMarkerQuickProfile((current) => {
                if (current && profileItems.some((profile) => profile.name === current)) {
                    return current;
                }

                return profileItems[0]?.name ?? '';
            });
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

    async function onEnsureProfilesFolder() {
        try {
            setIsLoading(true);
            setStatus('Creating Profiles folder...');
            setRecoveryHint('');
            await EnsureProfilesFolder();
            await loadData();
            setStatus('Profiles folder is ready.');
        } catch (error) {
            const feedback = toErrorFeedback(error, 'Failed to create Profiles folder');
            setStatus(feedback.message);
            setRecoveryHint(feedback.hint);
        } finally {
            setIsLoading(false);
        }
    }

    async function onCreateMarkerFile() {
        const selectedProfile = markerQuickProfile.trim();
        if (!selectedProfile) {
            setStatus('Select a profile first to create active_profile.txt.');
            return;
        }

        try {
            setIsLoading(true);
            setStatus(`Creating marker for ${selectedProfile}...`);
            setRecoveryHint('');
            await CreateMarkerFile(selectedProfile);
            setActiveProfile(selectedProfile);
            await loadData();
            setStatus(`active_profile.txt created for ${selectedProfile}.`);
        } catch (error) {
            const feedback = toErrorFeedback(error, 'Failed to create marker file');
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

    async function onExportBundle() {
        const profileName = exportProfileName.trim();
        const bundlePath = exportBundlePath.trim();
        if (!profileName || !bundlePath) {
            setStatus('Enter profile name and destination bundle path to export.');
            return;
        }

        try {
            setIsLoading(true);
            setStatus(`Exporting ${profileName} bundle...`);
            setRecoveryHint('');
            await ExportProfileBundle(profileName, bundlePath);
            setStatus(`Bundle exported: ${bundlePath}`);
        } catch (error) {
            const feedback = toErrorFeedback(error, 'Bundle export failed');
            setStatus(feedback.message);
            setRecoveryHint(feedback.hint);
        } finally {
            setIsLoading(false);
        }
    }

    async function onImportBundle() {
        const profileName = importProfileName.trim();
        const bundlePath = importBundlePath.trim();
        if (!profileName || !bundlePath) {
            setStatus('Enter profile name and source bundle path to import.');
            return;
        }

        try {
            setIsLoading(true);
            setStatus(`Importing bundle into ${profileName}...`);
            setRecoveryHint('');
            await ImportProfileBundle(profileName, bundlePath);
            await loadData();
            setStatus(`Bundle imported into profile ${profileName}.`);
        } catch (error) {
            const feedback = toErrorFeedback(error, 'Bundle import failed');
            setStatus(feedback.message);
            setRecoveryHint(feedback.hint);
        } finally {
            setIsLoading(false);
        }
    }

    async function onPickExportBundlePath() {
        try {
            const selected = await PickExportBundlePath();
            if (selected) {
                setExportBundlePath(selected);
            }
        } catch (error) {
            const feedback = toErrorFeedback(error, 'Failed to open save dialog');
            setStatus(feedback.message);
            setRecoveryHint(feedback.hint);
        }
    }

    async function onPickImportBundlePath() {
        try {
            const selected = await PickImportBundlePath();
            if (selected) {
                setImportBundlePath(selected);
            }
        } catch (error) {
            const feedback = toErrorFeedback(error, 'Failed to open file picker');
            setStatus(feedback.message);
            setRecoveryHint(feedback.hint);
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
                        <button className="action-btn secondary" onClick={() => void onApplyPath()} disabled={isLoading || isModalOpen || !canApplyPath}>
                            Apply Path
                        </button>
                    </div>
                    <p className="field-hint">Path must point directly to the `SaveGame` folder.</p>
                    <button className="refresh-btn" onClick={() => void loadData()} disabled={isLoading || isModalOpen}>
                        {isLoading ? 'Refreshing...' : 'Refresh'}
                    </button>
                </section>

                <section className="panel actions-panel">
                    <h2>Save Setup</h2>
                    <label className="field-label" htmlFor="fresh-profile-input">Start New Save</label>
                    <div className="field-row">
                        <input
                            id="fresh-profile-input"
                            value={freshProfileName}
                            onChange={(event) => setFreshProfileName(event.target.value)}
                            placeholder="New profile name"
                            disabled={isLoading || isModalOpen}
                        />
                        <button className="action-btn" onClick={() => void onPrepareFresh()} disabled={isLoading || isModalOpen || !canPrepareFresh}>
                            Start New Save
                        </button>
                    </div>

                    <label className="field-label" htmlFor="save-profile-input">Save Current Progress</label>
                    <div className="field-row">
                        <input
                            id="save-profile-input"
                            value={saveProfileName}
                            onChange={(event) => setSaveProfileName(event.target.value)}
                            placeholder="Leave blank to use active"
                            disabled={isLoading || isModalOpen}
                        />
                        <button className="action-btn secondary" onClick={() => void onSaveCurrent()} disabled={isLoading || isModalOpen || !canSaveCurrent}>
                            Save Current Progress
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
                    {(needsProfilesFolderFix || needsMarkerFileFix) && (
                        <div className="diag-actions">
                            <h3>Quick Actions</h3>
                            {needsProfilesFolderFix && (
                                <button className="action-btn secondary" onClick={() => void onEnsureProfilesFolder()} disabled={isLoading || isModalOpen}>
                                    Create Profiles folder
                                </button>
                            )}
                            {needsMarkerFileFix && (
                                <>
                                    {profiles.length > 0 ? (
                                        <div className="field-row">
                                            <select
                                                value={markerQuickProfile}
                                                onChange={(event) => setMarkerQuickProfile(event.target.value)}
                                                disabled={isLoading || isModalOpen}
                                            >
                                                {profiles.map((profile) => (
                                                    <option key={profile.name} value={profile.name}>
                                                        {profile.name}
                                                    </option>
                                                ))}
                                            </select>
                                            <button className="action-btn secondary" onClick={() => void onCreateMarkerFile()} disabled={isLoading || isModalOpen || !markerQuickProfile.trim()}>
                                                Create marker file
                                            </button>
                                        </div>
                                    ) : (
                                        <p className="field-hint">Create a profile first, then run this quick action again.</p>
                                    )}
                                </>
                            )}
                        </div>
                    )}
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

                <section className="panel bundle-panel">
                    <h2>Bundle Transfer</h2>

                    <label className="field-label" htmlFor="export-profile-input">Export profile bundle</label>
                    <div className="field-row bundle-row">
                        <input
                            id="export-profile-input"
                            value={exportProfileName}
                            onChange={(event) => setExportProfileName(event.target.value)}
                            placeholder="Profile name"
                            disabled={isLoading || isModalOpen}
                        />
                        <input
                            id="export-bundle-path-input"
                            value={exportBundlePath}
                            onChange={(event) => setExportBundlePath(event.target.value)}
                            placeholder="C:\\Path\\to\\profile.zip"
                            disabled={isLoading || isModalOpen}
                        />
                        <button className="action-btn secondary" onClick={() => void onPickExportBundlePath()} disabled={isLoading || isModalOpen}>
                            Browse...
                        </button>
                    </div>
                    <button className="action-btn" onClick={() => void onExportBundle()} disabled={isLoading || isModalOpen || !canExportBundle}>
                        Export Bundle
                    </button>

                    <label className="field-label" htmlFor="import-profile-input">Import profile bundle</label>
                    <div className="field-row bundle-row">
                        <input
                            id="import-profile-input"
                            value={importProfileName}
                            onChange={(event) => setImportProfileName(event.target.value)}
                            placeholder="Target profile name"
                            disabled={isLoading || isModalOpen}
                        />
                        <input
                            id="import-bundle-path-input"
                            value={importBundlePath}
                            onChange={(event) => setImportBundlePath(event.target.value)}
                            placeholder="C:\\Path\\to\\profile.zip"
                            disabled={isLoading || isModalOpen}
                        />
                        <button className="action-btn secondary" onClick={() => void onPickImportBundlePath()} disabled={isLoading || isModalOpen}>
                            Browse...
                        </button>
                    </div>
                    <button className="action-btn secondary" onClick={() => void onImportBundle()} disabled={isLoading || isModalOpen || !canImportBundle}>
                        Import Bundle
                    </button>
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
