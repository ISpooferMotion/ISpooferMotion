import {
  Button,
  FormInput,
  FormToggle,
  Group,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  MultiSelectDropdown,
} from '@codycon/ism-library';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { FolderSearch, ShieldAlert } from 'lucide-react';
import { useState } from 'react';

import AnimationIcon from '../../../assets/roblox_icons/Animation.png';
import DecalIcon from '../../../assets/roblox_icons/Decal.png';
import MeshIcon from '../../../assets/roblox_icons/MeshPart.png';
import ScriptIcon from '../../../assets/roblox_icons/Script.png';
import SoundIcon from '../../../assets/roblox_icons/Sound.png';
import { useConfig } from '../../../contexts/ConfigContext';
import { useLanguage } from '../../../contexts/LanguageContext';

export default function UploadSection() {
  const { t } = useLanguage();
  const { config, updateConfig } = useConfig();
  const [isVideoModalOpen, setIsVideoModalOpen] = useState(false);

  const uploadOptions = [
    { value: 'animation', assetType: 'animation', label: 'Animations', icon: AnimationIcon },
    { value: 'audio', assetType: 'audio', label: 'Audio', icon: SoundIcon },
    { value: 'image', assetType: 'image', label: 'Images', icon: DecalIcon },
    { value: 'mesh', assetType: 'mesh', label: 'Meshes', icon: MeshIcon },
    { value: 'script_ref', assetType: 'script_ref', label: 'Script Refs', icon: ScriptIcon },
  ];

  const handleBrowseFolder = async () => {
    const selected = await openDialog({ multiple: false, directory: true });
    if (selected && typeof selected === 'string') {
      updateConfig('spoofing', 'downloadPath', selected);
    }
  };

  return (
    <>
      <Group>
        <FormToggle
          label={t('settings.skipOwned')}
          description={t('settings.skipOwnedDescription')}
          checked={config.advanced.skipOwned}
          onChange={(value: boolean) => updateConfig('advanced', 'skipOwned', value)}
        />

        <FormToggle
          label="Preserve Original Metadata"
          description="When uploading, duplicate the Name and Description of the original asset so it looks 1:1 on the Roblox catalog."
          checked={config.spoofing.preserveMetadata}
          onChange={(value: boolean) => updateConfig('spoofing', 'preserveMetadata', value)}
        />

        <FormToggle
          label="Enable Archive Recovery (Slow)"
          description="Automatically scrape the Wayback Machine to find Place IDs for deleted/private animations. Can add 10-30 seconds per failed asset."
          checked={config.advanced.enableArchiveRecovery}
          onChange={(value: boolean) => updateConfig('advanced', 'enableArchiveRecovery', value)}
        />

        <div className="flex flex-col gap-1.5 pt-2">
          <span className="text-[13px] font-semibold text-text-primary px-1">
            Upload Configuration
          </span>
          <span className="text-xs text-text-muted px-1 mb-2">
            Selected asset types will be downloaded AND uploaded. Unselected types will only be
            downloaded.
          </span>
          <MultiSelectDropdown
            options={uploadOptions}
            values={config.spoofing.uploadTypes.filter((type: string) => type !== 'video')}
            onChange={(values: string[]) => {
              const hasVideo = config.spoofing.uploadTypes.includes('video');
              const newValues = hasVideo ? [...values, 'video'] : values;
              updateConfig('spoofing', 'uploadTypes', newValues);
            }}
            placeholder="Select asset types to upload..."
          />

          <div className="mt-2 p-3 bg-red-500/10 border border-red-500/20 rounded-md">
            <FormToggle
              label={
                <span className="text-danger font-semibold flex items-center gap-2">
                  Enable Video Uploads (Read Warning!)
                </span>
              }
              description="WARNING: Uploading videos to Roblox costs 2,000 Robux PER VIDEO. Only enable this if you are prepared to pay."
              checked={config.spoofing.uploadTypes.includes('video')}
              onChange={(checked: boolean) => {
                if (checked) {
                  setIsVideoModalOpen(true);
                } else {
                  updateConfig(
                    'spoofing',
                    'uploadTypes',
                    config.spoofing.uploadTypes.filter((type: string) => type !== 'video'),
                  );
                }
              }}
            />
          </div>
        </div>

        <div className="pt-2 pb-1">
          <FormInput
            label="Download Folder"
            placeholder="Select where downloads should be saved..."
            value={config.spoofing.downloadPath || ''}
            onChange={(value: string) => updateConfig('spoofing', 'downloadPath', value)}
            endContent={
              <button
                type="button"
                onClick={() => void handleBrowseFolder()}
                className="p-1 rounded text-text-muted hover:text-primary transition-colors"
                aria-label="Browse folder"
              >
                <FolderSearch size={16} />
              </button>
            }
          />
        </div>
      </Group>

      <Modal isOpen={isVideoModalOpen} onOpenChange={setIsVideoModalOpen}>
        <ModalContent>
          <ModalHeader className="text-danger flex items-center gap-2">
            <ShieldAlert size={20} />
            High Cost Warning
          </ModalHeader>
          <ModalBody className="text-text-primary">
            <p className="mb-2">Are you absolutely sure you want to enable video uploads?</p>
            <p className="font-semibold text-danger">
              Roblox charges exactly 2,000 Robux for EVERY single video asset you upload.
            </p>
            <p className="mt-2 text-sm text-text-muted">
              If you run a spoofing job with 10 videos, it will cost you 20,000 Robux. There are no
              refunds from Roblox if you accidentally upload videos you didn't mean to.
            </p>
          </ModalBody>
          <ModalFooter>
            <Button color="default" variant="flat" onClick={() => setIsVideoModalOpen(false)}>
              Cancel
            </Button>
            <Button
              color="danger"
              onClick={() => {
                const types = [...config.spoofing.uploadTypes];
                if (!types.includes('video')) types.push('video');
                updateConfig('spoofing', 'uploadTypes', types);
                setIsVideoModalOpen(false);
              }}
            >
              I Understand, Enable It
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}
