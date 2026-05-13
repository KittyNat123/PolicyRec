"use client";

import ProfilePage from "@/app/profile/page";

// ☑️수정: 데모 최종 구조에 맞춰 /mypage가 기존 프로필 화면과 수정 흐름을 그대로 담당하도록 재사용
export default function MyPage() {
  return <ProfilePage />;
}
