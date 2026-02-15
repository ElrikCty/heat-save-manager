import {useEffect, useState} from 'react';
import './App.css';
import {GetActiveProfile, GetPaths, ListProfiles, SwitchProfile} from '../wailsjs/go/main/App';

function App() {
    const [saveGamePath, setSaveGamePath] = useState('');
    const [profiles, setProfiles] = useState<Array<{ name: string }>>([]);
    const [activeProfile, setActiveProfile] = useState('');
    const [status, setStatus] = useState('Loading profiles...');
    const [isLoading, setIsLoading] = useState(true);

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
        <div id="App">
            <h1>Heat Save Manager</h1>
            <p className="result">{status}</p>
            <p className="result">SaveGame path: {saveGamePath || 'Not set'}</p>

            <div id="input" className="input-box">
                {profiles.length === 0 && <p>No profiles found in Profiles folder.</p>}
                {profiles.map((profile) => (
                    <button
                        key={profile.name}
                        className="btn"
                        onClick={() => onSwitch(profile.name)}
                        disabled={isLoading || profile.name === activeProfile}
                    >
                        {profile.name === activeProfile ? `${profile.name} (active)` : `Switch to ${profile.name}`}
                    </button>
                ))}
            </div>
        </div>
    );
}

export default App;
