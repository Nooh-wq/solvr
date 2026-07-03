import { getMyProfile } from "@/actions/profile";
import { ProfileForm } from "@/components/profile-form";

export default async function ProfilePage() {
  const profile = await getMyProfile();
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Profile</h1>
      <ProfileForm profile={profile} />
    </div>
  );
}
